const AREAS = new Set(["app", "library", "grade", "denoise", "gpu", "memory", "raw", "export", "proof", "match"]);
const LEVELS = new Set(["info", "warn", "error"]);
const ACTION = /^[a-zA-Z0-9_-]{1,80}$/;
const NAME = /^[a-z][a-z0-9_]{0,79}$/;
const MAX_EVENT_BYTES = 8192;
const PRIVATE_FIELD = /secret|password|authorization|cookie|^token$|request.?body|base64|^(pixels?|pixel_data|data)$/i;

function sanitize(value, depth = 0) {
  if (typeof value === "string") return value.slice(0, 1000);
  if (value === null || typeof value === "boolean" || Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || depth === 3) return undefined;
  if (Array.isArray(value)) return value.slice(0, 16).map(item => sanitize(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 48)
    .filter(([key]) => key.length <= 80 && !PRIVATE_FIELD.test(key))
    .map(([key, item]) => [key, sanitize(item, depth + 1)]));
}

function create(write, { quietMs = 250 } = {}) {
  let previous, key, timer, repeated, seq = 0;
  function flush() {
    clearTimeout(timer);
    if (repeated) write(JSON.stringify({ ...previous, repeat_count: repeated, repeat_summary: true }));
    previous = key = null;
    repeated = 0;
  }

  function ingest(record, proc, pid) {
    if (!record || !AREAS.has(record.area) || !NAME.test(record.event) || !LEVELS.has(record.level)) return false;
    const { time, seq: sourceSeq, instance, action, photo, ...fields } = record;
    const detail = { ...sanitize(fields), proc, pid, action: ACTION.test(action ?? "") ? action : null,
      photo: photo && typeof photo === "object" ? sanitize(photo) : null,
      ...(typeof instance === "string" && ACTION.test(instance) ? { instance } : {}) };
    delete detail.repeat_summary;
    delete detail.repeat_count;
    const entry = { ...detail, time: Number.isFinite(time) ? time : Date.now() / 1000,
      seq: Number.isSafeInteger(sourceSeq) && sourceSeq > 0 ? sourceSeq : ++seq };
    const line = JSON.stringify(entry);
    if (Buffer.byteLength(line) > MAX_EVENT_BYTES) return false;
    const signature = JSON.stringify(detail);
    if (signature === key) {
      previous = entry;
      repeated++;
    } else {
      flush();
      previous = entry;
      key = signature;
      write(line);
    }
    clearTimeout(timer);
    timer = setTimeout(flush, quietMs);
    timer.unref?.();
    return true;
  }

  function backend(line, pid) {
    if (line.startsWith("{")) {
      try {
        const record = JSON.parse(line);
        if (record.proc === "backend") return ingest(record, "backend", pid);
        if (record.proc === "batch_worker" && Number.isSafeInteger(record.pid) && record.pid > 0) {
          return ingest(record, "batch_worker", record.pid);
        }
      } catch { /* Preserve other backend output in its original form. */ }
    }
    flush();
    return write(line);
  }
  return { ingest, backend, flush };
}
module.exports = { create };
