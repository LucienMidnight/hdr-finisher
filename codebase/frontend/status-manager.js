(function statusManagerModule(global) {
  "use strict";

  const SUCCESS_TIMEOUT_MS = 4000;
  const SEVERITIES = new Set(["info", "progress", "success", "error", "attention"]);

  function create(container, { successTimeoutMs = SUCCESS_TIMEOUT_MS, focusFallback = null, emptyMessage = null } = {}) {
    if (!container) throw new Error("A status entry container is required.");
    const entries = new Map();
    let emptyNode = null;

    const syncEmptyState = () => {
      if (!emptyMessage || entries.size) {
        emptyNode?.remove();
        emptyNode = null;
        return;
      }
      if (emptyNode) return;
      emptyNode = document.createElement("section");
      emptyNode.className = "status-entry status-info";
      emptyNode.dataset.statusId = "application";
      emptyNode.setAttribute("role", "status");
      const copy = document.createElement("span");
      copy.className = "status-entry-copy";
      copy.textContent = emptyMessage;
      emptyNode.append(copy);
      container.append(emptyNode);
    };

    const clearTimer = (record) => {
      if (!record?.timer) return;
      global.clearTimeout(record.timer);
      record.timer = 0;
    };

    const remainingTime = (record) => Math.max(0, record.deadline - performance.now());

    const scheduleDismiss = (record, delay = successTimeoutMs) => {
      clearTimer(record);
      record.remaining = delay;
      record.deadline = performance.now() + delay;
      record.timer = global.setTimeout(() => clear(record.entry.id), delay);
    };

    const pauseDismiss = (record) => {
      if (record.entry.severity !== "success" || !record.timer) return;
      record.remaining = remainingTime(record);
      clearTimer(record);
    };

    const resumeDismiss = (record) => {
      if (record.entry.severity !== "success" || record.timer) return;
      scheduleDismiss(record, Math.max(1, record.remaining || successTimeoutMs));
    };

    function clear(id, { restoreFocus = false, syncEmpty = true } = {}) {
      const record = entries.get(id);
      if (!record) return false;
      const ownedFocus = record.node.contains(document.activeElement);
      clearTimer(record);
      record.node.remove();
      entries.delete(id);
      if (restoreFocus && ownedFocus) {
        const target = typeof focusFallback === "function" ? focusFallback() : focusFallback;
        (target || document.querySelector("#project-open, #file-open, button, [tabindex='0']"))?.focus?.();
      }
      if (syncEmpty) syncEmptyState();
      return true;
    }

    function post(entry) {
      if (!entry?.id) throw new Error("Status entries need an id/channel.");
      const severity = SEVERITIES.has(entry.severity) ? entry.severity : "info";
      const normalized = { ...entry, id: String(entry.id), severity, message: String(entry.message || "") };
      clear(normalized.id, { syncEmpty: false });
      emptyNode?.remove();
      emptyNode = null;

      const node = document.createElement("section");
      if (normalized.nodeId) node.id = normalized.nodeId;
      node.className = `status-entry status-${severity}`;
      node.dataset.statusId = normalized.id;
      node.setAttribute("role", severity === "error" ? "alert" : "status");
      if (severity === "success") node.tabIndex = 0;

      const copy = document.createElement("span");
      if (normalized.copyId) copy.id = normalized.copyId;
      copy.className = "status-entry-copy";
      copy.textContent = normalized.message;
      node.append(copy);

      if (normalized.progress !== undefined && normalized.progress !== null) {
        const progress = document.createElement("progress");
        if (normalized.progressId) progress.id = normalized.progressId;
        progress.className = "status-entry-progress";
        progress.setAttribute("aria-label", normalized.progressLabel || normalized.message || "Progress");
        if (Number.isFinite(Number(normalized.progress))) {
          progress.max = 100;
          progress.value = Math.max(0, Math.min(100, Number(normalized.progress)));
        }
        node.append(progress);
      }

      const actions = normalized.actions || (normalized.action ? [normalized.action] : []);
      if (actions.length || severity === "error" || normalized.dismissible) {
        const controls = document.createElement("span");
        controls.className = "status-entry-actions";
        actions.forEach((action) => {
          const button = document.createElement("button");
          if (action.id) button.id = action.id;
          button.type = "button";
          button.className = "button-secondary";
          button.textContent = action.label;
          button.addEventListener("click", () => action.run?.());
          controls.append(button);
        });
        if (severity === "error" || normalized.dismissible) {
          const dismiss = document.createElement("button");
          dismiss.type = "button";
          dismiss.className = "text-button status-entry-dismiss";
          dismiss.setAttribute("aria-label", `Dismiss ${normalized.message}`);
          dismiss.textContent = "Dismiss";
          dismiss.addEventListener("click", () => clear(normalized.id, { restoreFocus: true }));
          controls.append(dismiss);
        }
        node.append(controls);
      }

      const record = { entry: normalized, node, timer: 0, remaining: successTimeoutMs, deadline: 0 };
      entries.set(normalized.id, record);
      container.append(node);
      node.addEventListener("mouseenter", () => pauseDismiss(record));
      node.addEventListener("mouseleave", () => resumeDismiss(record));
      node.addEventListener("focusin", () => pauseDismiss(record));
      node.addEventListener("focusout", (event) => {
        if (!node.contains(event.relatedTarget)) resumeDismiss(record);
      });
      if (severity === "success" && normalized.persistent !== true) scheduleDismiss(record);
      return node;
    }

    function update(id, patch) {
      const current = entries.get(String(id));
      return post({ ...(current?.entry || { id }), ...patch, id });
    }

    function get(id) {
      return entries.get(String(id))?.entry || null;
    }

    syncEmptyState();
    return { post, update, clear, get };
  }

  global.HDRStatusManager = Object.freeze({ create, SUCCESS_TIMEOUT_MS });
  const container = document.getElementById("application-status-entries");
  if (container) {
    global.HDRStatus = create(container, {
      focusFallback: () => document.getElementById("project-open") || document.getElementById("file-open"),
      emptyMessage: "Ready",
    });
  }
})(window);
