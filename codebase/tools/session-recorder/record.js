#!/usr/bin/env node
// Recorded session: launches HDR Finisher from source with a local debugging
// port, then records how it behaves while Steve uses it normally.
//
//   node tools/session-recorder/record.js            (from codebase)
//
// Records, with timestamps, into output/recorder/<start time>/:
//   events.jsonl  every event (windows, backend log, GPU, CPU, memory, disk)
//   alerts.log    only the moments worth a look (stalls, errors, F9 markers)
//   report.md     written by report.js when the app closes
// Nothing in the app, its settings or the photos is changed. Press F9 in any
// window to mark "that felt slow".
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const codebase = path.resolve(__dirname, "..", "..");
const desktop = path.join(codebase, "desktop");
const port = Number(process.env.HDR_RECORDER_PORT || 9333);
const started = new Date();
const stamp = started.toISOString().replace(/[:.]/g, "-").slice(0, 19);
const folder = path.resolve(process.env.HDR_RECORDER_OUTPUT || path.join(codebase, "output", "recorder", stamp));
fs.mkdirSync(folder, { recursive: true });
const userData = process.env.HDR_FINISHER_USER_DATA_DIR
  || path.join(process.env.APPDATA || path.join(os.homedir(), ".config"), "hdr-finisher-desktop");

const eventsFile = fs.openSync(path.join(folder, "events.jsonl"), "a");
const alertsFile = fs.openSync(path.join(folder, "alerts.log"), "a");
const clock = (t) => new Date(t).toLocaleTimeString("en-GB", { hour12: false }) + "." + String(Math.floor(t % 1000)).padStart(3, "0");

function record(event) {
  const value = { t: event.t || Date.now(), ...event };
  fs.writeSync(eventsFile, JSON.stringify(value) + "\n");
  const alert = alertText(value);
  if (alert) {
    const line = `${clock(value.t)} ${alert}`;
    fs.writeSync(alertsFile, line + "\n");
    console.log(line);
  }
}

// Thresholds for alerts.log; events.jsonl keeps everything.
function alertText(e) {
  switch (e.kind) {
    case "marker": return `MARKER (F9) in ${e.window}`;
    case "long-task": return e.ms >= 500 ? `STALL ${e.window}: main thread busy ${e.ms} ms` : null;
    case "slow-input": return e.ms >= 300 ? `SLOW INPUT ${e.window}: ${e.input} on ${e.target || "?"} took ${e.ms} ms` : null;
    case "frame-gap": return e.ms >= 500 ? `HITCH ${e.window}: no frame for ${e.ms} ms` : null;
    case "console": return e.level === "error" ? `ERROR ${e.window}: ${e.text.slice(0, 240)}` : null;
    case "page-error": return `PAGE ERROR ${e.window}: ${e.text.slice(0, 240)}`;
    case "window-crash": return `WINDOW CRASHED: ${e.window}`;
    case "backend-line": return /traceback|error|exception/i.test(e.text) ? `BACKEND: ${e.text.slice(0, 240)}` : null;
    case "backend-event":
      if (e.fields?.fallback_reason || e.fields?.error) return `BACKEND ${e.event}: ${String(e.fields.fallback_reason || e.fields.error).slice(0, 200)}`;
      if (e.event === "gpu_delivery_turn" && e.fields?.total_ms > 8000) return `SLOW GPU TURN ${Math.round(e.fields.total_ms)} ms`;
      return null;
    case "app-exit": return `APP CLOSED (code ${e.code})`;
    default: return null;
  }
}

// ---- The app ----------------------------------------------------------------
const electron = require(path.join(desktop, "node_modules", "electron"));
const app = spawn(electron, [".", `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"], {
  cwd: desktop, env: process.env, stdio: ["ignore", "ignore", "ignore"], windowsHide: false,
});
record({ kind: "session-start", folder, userData, port, pid: app.pid });
console.log(`Recording to ${folder}\nPress F9 in the app to mark a moment. Close the app to finish.`);

// ---- Windows ----------------------------------------------------------------
const probe = fs.readFileSync(path.join(__dirname, "page-probe.js"), "utf8");
const pages = new Map();
// "/" is the main (Grade) window, "/library" a Library window, and the hidden
// GPU delivery renderer is gpu-delivery.html (desktop/main.js).
function windowName(page) {
  const url = page.url();
  let pathname = "";
  try { pathname = new URL(url).pathname; } catch { return url || "window"; }
  if (pathname === "/" || pathname === "") return "grade";
  return pathname.split("/").pop().replace(/\.html$/, "") || "window";
}
async function attach(page) {
  if (pages.has(page)) return;
  const entry = { name: windowName(page), ready: false };
  pages.set(page, entry);
  const inject = async () => {
    entry.name = windowName(page);
    try { await page.evaluate(probe); entry.ready = true; } catch { entry.ready = false; }
  };
  page.on("load", inject);
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) record({ kind: "console", level: message.type(), window: entry.name, text: message.text() });
  });
  page.on("pageerror", (error) => record({ kind: "page-error", window: entry.name, text: String(error?.message || error) }));
  page.on("crash", () => record({ kind: "window-crash", window: entry.name }));
  page.on("close", () => { pages.delete(page); record({ kind: "window-closed", window: entry.name }); });
  record({ kind: "window-opened", window: entry.name, url: page.url() });
  await inject();
}
async function drainWindows() {
  for (const [page, entry] of pages) {
    if (!entry.ready) continue;
    try {
      const events = await page.evaluate(() => window.__hdrRecorder ? window.__hdrRecorder.drain() : null);
      if (events === null) { entry.ready = false; continue; }
      for (const event of events) record({ ...event, t: Math.round(event.t), window: entry.name });
    } catch { /* navigating or closing; the load handler re-injects */ }
  }
}

async function connect() {
  const deadline = Date.now() + 120000;
  for (;;) {
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${port}`); }
    catch (error) {
      if (Date.now() > deadline || app.exitCode !== null) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

// ---- Backend log ------------------------------------------------------------
function tail(file, kind) {
  let offset = fs.existsSync(file) ? fs.statSync(file).size : 0, rest = "";
  setInterval(() => {
    let size;
    try { size = fs.statSync(file).size; } catch { return; }
    if (size < offset) offset = 0;
    if (size === offset) return;
    const handle = fs.openSync(file, "r"), buffer = Buffer.alloc(Math.min(size - offset, 8 * 1048576));
    fs.readSync(handle, buffer, 0, buffer.length, offset); fs.closeSync(handle);
    offset += buffer.length;
    const lines = (rest + buffer.toString("utf8")).split(/\r?\n/); rest = lines.pop();
    for (const line of lines) {
      const library = line.match(/\[library\] (\S+) (\{.*\})\s*$/);
      if (library) {
        let fields = {};
        try { fields = JSON.parse(library[2]); } catch {}
        const t = fields.time ? Math.round(fields.time * 1000) : Date.now(); delete fields.time;
        record({ kind: "backend-event", source: kind, event: library[1], fields, t });
      } else if (/error|exception|traceback|failed|fallback|warning/i.test(line)) {
        record({ kind: "backend-line", source: kind, text: line.slice(0, 400) });
      }
    }
  }, 1000);
}
tail(path.join(userData, "logs", "backend.log"), "backend");
tail(path.join(userData, "logs", "desktop.log"), "desktop");

// ---- Machine ----------------------------------------------------------------
const helpers = [];
function stream(command, args, onLine) {
  try {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    helpers.push(child);
    let rest = "";
    child.stdout.on("data", (chunk) => {
      const lines = (rest + chunk.toString()).split(/\r?\n/); rest = lines.pop();
      for (const line of lines) if (line.trim()) onLine(line.trim());
    });
    child.on("error", () => {});
  } catch {}
}
// GPU load and graphics memory once a second.
stream("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits", "-l", "1"], (line) => {
  const [gpu, used, total] = line.split(",").map((v) => Number(v.trim()));
  if (Number.isFinite(gpu)) record({ kind: "gpu", busyPercent: gpu, vramMB: used, vramTotalMB: total });
});
// Disk activity (the photos live on a USB drive).
if (process.platform === "win32") {
  stream("typeperf", ["\\PhysicalDisk(_Total)\\% Disk Time", "\\PhysicalDisk(_Total)\\Disk Read Bytes/sec", "-si", "1"], (line) => {
    const values = line.split(",").map((v) => Number(v.replace(/"/g, "")));
    if (values.length === 3 && Number.isFinite(values[1])) record({ kind: "disk", busyPercent: Math.round(values[1]), readMBps: Math.round(values[2] / 1048576) });
  });
}
// CPU load once a second.
let cpuLast = os.cpus();
setInterval(() => {
  const now = os.cpus();
  let busy = 0, total = 0;
  now.forEach((cpu, i) => {
    const a = cpu.times, b = cpuLast[i].times;
    const all = (a.user + a.nice + a.sys + a.irq + a.idle) - (b.user + b.nice + b.sys + b.irq + b.idle);
    total += all; busy += all - (a.idle - b.idle);
  });
  cpuLast = now;
  if (total > 0) record({ kind: "cpu", busyPercent: Math.round(100 * busy / total), freeRamMB: Math.round(os.freemem() / 1048576) });
}, 1000);
// App process memory every 5 s.
if (process.platform === "win32") {
  setInterval(() => {
    const child = spawn("powershell", ["-NoProfile", "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='electron.exe' or Name='python.exe'\" | ForEach-Object { $_.Name + ',' + $_.WorkingSetSize + ',' + ($_.CommandLine -match 'batch_export_worker') }"],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let text = "";
    child.stdout.on("data", (chunk) => { text += chunk; });
    child.on("close", () => {
      const sums = { electronMB: 0, backendMB: 0, exportWorkers: 0 };
      for (const line of text.split(/\r?\n/)) {
        const [name, bytes, worker] = line.split(",");
        if (!name) continue;
        if (/electron/i.test(name)) sums.electronMB += Number(bytes) / 1048576;
        else { sums.backendMB += Number(bytes) / 1048576; if (worker === "True") sums.exportWorkers += 1; }
      }
      record({ kind: "processes", electronMB: Math.round(sums.electronMB), pythonMB: Math.round(sums.backendMB), exportWorkers: sums.exportWorkers });
    });
  }, 5000);
}

// ---- Run --------------------------------------------------------------------
let finished = false;
async function finish(code) {
  if (finished) return; finished = true;
  record({ kind: "app-exit", code });
  for (const child of helpers) { try { child.kill(); } catch {} }
  fs.closeSync(eventsFile); fs.closeSync(alertsFile);
  try {
    require("./report").writeReport(folder);
    console.log(`Report: ${path.join(folder, "report.md")}`);
  } catch (error) { console.error("Report failed:", error); }
  process.exit(0);
}
app.on("exit", (code) => finish(code));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { try { app.kill(); } catch {} finish("stopped"); });

(async () => {
  const browser = await connect();
  const contexts = new Set();
  const scan = async () => {
    for (const context of browser.contexts()) {
      if (!contexts.has(context)) { contexts.add(context); context.on("page", attach); }
      for (const page of context.pages()) await attach(page);
    }
  };
  await scan();
  setInterval(() => { scan().catch(() => {}); drainWindows(); }, 1000);
})().catch((error) => { record({ kind: "recorder-error", text: String(error?.stack || error) }); console.error(error); });
