/* Decisions are independent of the optional frame instrumentation. */
(function (root) {
  const ACTION_HEADER = "X-HDR-Finisher-Action";
  function create({ send, now = Date.now, newId = () => root.crypto.randomUUID() } = {}) {
    let seq = 0;
    const instance = send ? newId() : null;
    function event(area, name, fields = {}, context = null) {
      if (!send) return;
      const { level = "info", action = null, photo = null, ...detail } = fields;
      try {
        send({ ...detail, area, event: name, level, time: now() / 1000, seq: ++seq, instance,
          action: context?.id ?? action, photo: context?.photo ?? photo });
      } catch { /* A closing desktop bridge must never interrupt the action. */ }
    }
    function start(area, operation, photo = null, fields = {}) {
      const context = { id: newId(), photo };
      const started = now();
      let finished = false;
      event(area, "action_started", { ...fields, operation }, context);
      return {
        ...context,
        finish(outcome, detail = {}) {
          if (finished) return;
          finished = true;
          event(area, "action_finished", { ...detail, operation, outcome, duration_ms: now() - started }, context);
        },
      };
    }
    function headers(context, initial) {
      if (!context?.id) return initial;
      const result = new Headers(initial);
      result.set(ACTION_HEADER, context.id);
      return result;
    }
    return { event, start, headers };
  }
  if (typeof module === "object" && module.exports) module.exports = { create, ACTION_HEADER };
  else root.HDRDiagnostics = create({ send: root.hdrFinisherDesktop?.diagnosticEvent ?? root.hdrDeliveryMemory?.diagnosticEvent });
})(globalThis);
