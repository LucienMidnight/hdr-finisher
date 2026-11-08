'use strict';
/**
 * Exit report for the Electron launchers. The driver's own result always comes
 * first and keeps its exit code; a shutdown problem is a separate line after it.
 */
const { describe } = require('./release/process-tree.cjs');

function shutdownLines(code, report) {
  const lines = [`[runner] driver result: ${code === 0 ? 'passed' : 'failed'} (exit code ${code})`];
  if (!report) return lines;
  for (const note of report.notes) lines.push(`[runner] shutdown note (separate from the driver result): ${note}`);
  if (report.blocking.length) {
    lines.push(`[runner] SHUTDOWN WARNING (separate from the driver result): Electron still running after shutdown: ${describe(report.blocking)}`);
  }
  const others = report.survivors.filter(item => !report.blocking.includes(item));
  if (others.length) {
    lines.push(`[runner] SHUTDOWN WARNING (separate from the driver result): other processes still running: ${describe(others)}`);
  }
  return lines;
}

function reportShutdown(code, report, write = line => process.stderr.write(line + '\n')) {
  for (const line of shutdownLines(code, report)) write(line);
}

module.exports = { shutdownLines, reportShutdown };
