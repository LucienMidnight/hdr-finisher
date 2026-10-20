#!/usr/bin/env node
// Summarises a recorded session into report.md.
//   node tools/session-recorder/report.js output/recorder/<session>
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const clock = (t) => new Date(t).toLocaleTimeString("en-GB", { hour12: false }) + "." + String(Math.floor(t % 1000)).padStart(3, "0");
const seconds = (ms) => (ms / 1000).toFixed(1) + " s";
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const max = (values) => values.length ? Math.max(...values) : null;

function load(folder) {
  return fs.readFileSync(path.join(folder, "events.jsonl"), "utf8").split(/\r?\n/).filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean)
    .sort((a, b) => a.t - b.t);
}

const isStall = (e) => (e.kind === "long-task" && e.ms >= 200) || (e.kind === "slow-input" && e.ms >= 200) || (e.kind === "frame-gap" && e.ms >= 250);
const describe = (e) => {
  switch (e.kind) {
    case "long-task": return `${e.window}: main thread busy ${e.ms} ms`;
    case "slow-input": return `${e.window}: ${e.input} on ${e.target || "?"} took ${e.ms} ms (waited ${e.waitMs} ms to start)`;
    case "frame-gap": return `${e.window}: no frame for ${e.ms} ms`;
    case "console": return `${e.window} ${e.level}: ${e.text.slice(0, 160)}`;
    case "page-error": return `${e.window} page error: ${e.text.slice(0, 160)}`;
    case "backend-event": return `backend ${e.event}${e.fields?.total_ms ? " " + Math.round(e.fields.total_ms) + " ms" : ""}${e.fields?.fallback_reason ? " (" + e.fields.fallback_reason + ")" : ""}${e.fields?.error ? " (" + e.fields.error + ")" : ""}`;
    case "backend-line": return `backend: ${e.text.slice(0, 160)}`;
    case "marker": return `F9 marker in ${e.window}`;
    default: return e.kind;
  }
};

// Machine load and what else happened around a moment.
function context(events, from, to) {
  const inside = events.filter((e) => e.t >= from && e.t <= to);
  const gpu = inside.filter((e) => e.kind === "gpu"), cpu = inside.filter((e) => e.kind === "cpu"), disk = inside.filter((e) => e.kind === "disk");
  const load = [
    gpu.length ? `GPU ${Math.round(mean(gpu.map((e) => e.busyPercent)))}% (peak ${max(gpu.map((e) => e.busyPercent))}%), VRAM ${max(gpu.map((e) => e.vramMB))} MB` : null,
    cpu.length ? `CPU ${Math.round(mean(cpu.map((e) => e.busyPercent)))}% (peak ${max(cpu.map((e) => e.busyPercent))}%)` : null,
    disk.length ? `disk busy ${Math.round(mean(disk.map((e) => e.busyPercent)))}%, reading up to ${max(disk.map((e) => e.readMBps))} MB/s` : null,
  ].filter(Boolean).join("; ");
  const backend = {};
  for (const e of inside.filter((e) => e.kind === "backend-event")) backend[e.event] = (backend[e.event] || 0) + 1;
  const notable = inside.filter((e) => isStall(e) || ["page-error", "backend-line", "marker"].includes(e.kind)
    || (e.kind === "console" && e.level === "error")
    || (e.kind === "backend-event" && (e.event === "gpu_delivery_turn" || e.fields?.fallback_reason || e.fields?.error)));
  return { load, backend, notable };
}

function section(events, title, at, before, after) {
  const { load, backend, notable } = context(events, at - before, at + after);
  const lines = [`### ${title}`, "", `Machine (${seconds(before)} before to ${seconds(after)} after): ${load || "no samples"}`];
  const counts = Object.entries(backend).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => `${name} x${count}`);
  if (counts.length) lines.push(`Backend activity: ${counts.join(", ")}`);
  lines.push("");
  for (const e of notable.slice(0, 25)) lines.push(`- ${clock(e.t)} ${describe(e)}`);
  if (notable.length > 25) lines.push(`- ... ${notable.length - 25} more`);
  lines.push("");
  return lines;
}

function writeReport(folder) {
  const events = load(folder);
  if (!events.length) throw new Error("No events recorded.");
  const start = events[0].t, end = events[events.length - 1].t;
  const out = [`# Recorded session ${new Date(start).toLocaleString("en-GB")}`, "",
    `Length ${seconds(end - start)}. Thresholds: stall = main thread busy 200 ms+, slow input = 200 ms+ from click/key to paint, hitch = no frame for 250 ms+ in a visible window.`, ""];

  // Per window.
  const windows = [...new Set(events.filter((e) => e.window).map((e) => e.window))];
  out.push("## Windows", "", "| Window | Stalls (200 ms+) | Busy total | Worst stall | Slow inputs | Worst input | Hitches | Worst hitch | Errors |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const name of windows) {
    const own = events.filter((e) => e.window === name);
    const tasks = own.filter((e) => e.kind === "long-task"), stalls = tasks.filter((e) => e.ms >= 200);
    const inputs = own.filter((e) => e.kind === "slow-input" && e.ms >= 200), gaps = own.filter((e) => e.kind === "frame-gap" && e.ms >= 250);
    const errors = own.filter((e) => (e.kind === "console" && e.level === "error") || e.kind === "page-error");
    out.push(`| ${name} | ${stalls.length} | ${seconds(tasks.reduce((s, e) => s + e.ms, 0))} | ${max(stalls.map((e) => e.ms)) ?? "-"} ms | ${inputs.length} | ${max(inputs.map((e) => e.ms)) ?? "-"} ms | ${gaps.length} | ${max(gaps.map((e) => e.ms)) ?? "-"} ms | ${errors.length} |`);
  }
  out.push("");

  // Steve's markers.
  const markers = events.filter((e) => e.kind === "marker");
  out.push(`## F9 markers (${markers.length})`, "");
  if (!markers.length) out.push("None pressed.", "");
  markers.forEach((m, i) => out.push(...section(events, `Marker ${i + 1} at ${clock(m.t)} (${m.window})`, m.t, 15000, 3000)));

  // Worst moments, one per 5 s so a single freeze is not listed ten times.
  const worst = events.filter(isStall).sort((a, b) => b.ms - a.ms), chosen = [];
  for (const e of worst) { if (chosen.every((c) => Math.abs(c.t - e.t) > 5000)) chosen.push(e); if (chosen.length >= 10) break; }
  out.push("## Ten worst moments", "");
  if (!chosen.length) out.push("No stalls, slow inputs or hitches over the thresholds.", "");
  chosen.sort((a, b) => a.t - b.t).forEach((e) => out.push(...section(events, `${clock(e.t)}: ${describe(e)}`, e.t, 5000, 2000)));

  // Errors, grouped.
  const errors = {};
  for (const e of events.filter((e) => (e.kind === "console" && e.level === "error") || e.kind === "page-error" || e.kind === "window-crash"
      || (e.kind === "backend-line" && /traceback|error|exception/i.test(e.text)))) {
    const key = describe(e).replace(/\d+/g, "#");
    errors[key] = errors[key] || { count: 0, first: e.t, text: describe(e) }; errors[key].count += 1;
  }
  out.push("## Errors", "");
  const grouped = Object.values(errors).sort((a, b) => b.count - a.count);
  if (!grouped.length) out.push("None.");
  for (const e of grouped.slice(0, 30)) out.push(`- x${e.count}, first ${clock(e.first)}: ${e.text}`);
  out.push("");

  // GPU export turns and fallbacks.
  const turns = events.filter((e) => e.kind === "backend-event" && e.event === "gpu_delivery_turn" && !e.fields?.error);
  const fallbacks = events.filter((e) => e.kind === "backend-event" && e.fields?.fallback_reason);
  out.push("## Export and Proof on the GPU", "");
  out.push(turns.length ? `${turns.length} GPU turns, mean ${seconds(mean(turns.map((e) => e.fields.total_ms || 0)))}, longest ${seconds(max(turns.map((e) => e.fields.total_ms || 0)))}.` : "No GPU export or Proof turns.");
  if (fallbacks.length) out.push("", "CPU fallbacks:", ...fallbacks.slice(0, 20).map((e) => `- ${clock(e.t)} ${e.event}: ${e.fields.fallback_reason}`));
  out.push("");

  // Resources.
  const of = (kind, key) => events.filter((e) => e.kind === kind).map((e) => e[key]).filter(Number.isFinite);
  out.push("## Resources", "",
    `- GPU busy: mean ${Math.round(mean(of("gpu", "busyPercent")) ?? 0)}%, peak graphics memory ${max(of("gpu", "vramMB")) ?? "?"} of ${max(of("gpu", "vramTotalMB")) ?? "?"} MB`,
    `- CPU busy: mean ${Math.round(mean(of("cpu", "busyPercent")) ?? 0)}%, lowest free RAM ${Math.min(...of("cpu", "freeRamMB"), Infinity)} MB`,
    `- Peak memory: app windows ${max(of("processes", "electronMB")) ?? "?"} MB, backend and helpers ${max(of("processes", "pythonMB")) ?? "?"} MB (most export helpers at once: ${max(of("processes", "exportWorkers")) ?? 0})`,
    `- JavaScript heap: peak ${max(of("memory", "usedMB")) ?? "?"} MB in one window`, "");
  fs.writeFileSync(path.join(folder, "report.md"), out.join("\n"));
  return path.join(folder, "report.md");
}

module.exports = { writeReport };
if (require.main === module) {
  const folder = process.argv[2];
  if (!folder) { console.error("Usage: report.js <session folder>"); process.exit(1); }
  console.log(writeReport(path.resolve(folder)));
}
