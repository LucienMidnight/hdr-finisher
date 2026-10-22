/* Native-source Inpaint authoring. One completed gesture is one history edit. */
const retouchUI = { active: false, busy: false, cancelled: false, points: null, cursor: null, selected: null, session: null };

function retouchInput(name) { return document.getElementById(`retouch-${name}`); }

function retouchMessage(message) { retouchInput("status").textContent = message; }

function constrainRetouchSize() {
  const input = retouchInput("size");
  const typed = Number(input.value);
  const size = input.value.trim() && Number.isFinite(typed)
    ? Math.min(64, Math.max(1, typed)) : 12;
  if (input.value.trim() === "" || typed !== size) {
    input.value = String(size);
    retouchMessage(`Size set to ${size} native pixels. This prototype supports sizes from 1 to 64.`);
  }
}

function retouchValues() {
  // Number inputs allow manual values outside min/max. Keep the displayed
  // brush usable instead of rejecting every stroke after such an entry.
  constrainRetouchSize();
  const read = (name, min, max, integer = true) => {
    const value = Number(retouchInput(name).value);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw new Error(`Choose a valid ${name} between ${min} and ${max}.`);
    }
    return value;
  };
  return { radius: read("size", 1, 64, false) / 2, hardness: read("hardness", 0, 100, false) / 100,
    search: read("search", 32, 256), patch: read("patch", 1, 5), iterations: read("iterations", 1, 12),
    seed: read("seed", 0, 4294967295) };
}

function retouchRecipe(points) {
  const v = retouchValues();
  const width = state.session.source.width, height = state.session.source.height;
  const xs = points.map(p => p.x * width), ys = points.map(p => p.y * height);
  const axis = (values, length) => {
    const lower = Math.max(0, Math.floor(Math.min(...values) - v.radius));
    const upper = Math.min(length, Math.ceil(Math.max(...values) + v.radius));
    const edge = Math.min(v.search, length);
    if (upper - lower > edge) throw new Error("Stroke is wider than the search area. Use a smaller stroke or larger search.");
    const start = Math.max(0, Math.min(length - edge, Math.floor((lower + upper - edge) / 2)));
    return [start, start + edge];
  };
  const [left, right] = axis(xs, width), [top, bottom] = axis(ys, height);
  return { schema_version: 1, mode: "inpaint", raster_version: "native-capsules-v1",
    source_size: [width, height], search_rect: [left, top, right, bottom], points,
    radius_px: v.radius, hardness: v.hardness,
    settings: { patch_radius: v.patch, iterations: v.iterations, seed: v.seed, algorithm: "hdrf-patchmatch-cpu-v3" } };
}

async function commitRetouch(records) {
  if (retouchUI.busy || !state.session) return false;
  retouchUI.busy = true;
  retouchUI.cancelled = false;
  retouchUI.requestId = crypto.randomUUID();
  const sessionId = state.session.session_id;
  retouchMessage("Repairing… the previous picture stays available. Escape cancels.");
  renderRetouchControls();
  try {
    const applied = await queueEditCommand("set_repairs", { repairs: records, repair_request_id: retouchUI.requestId }, null, { isCurrent: () => !retouchUI.cancelled });
    if (state.session?.session_id === sessionId) {
      retouchMessage(applied ? "Repair saved · shared by HDR and SDR." : "Repair was not applied. See the edit message; previous picture retained.");
    }
    return applied;
  } finally {
    retouchUI.busy = false;
    renderRetouchControls();
  }
}

function renderRetouchControls() {
  if (!retouchInput("brush")) return;
  const sessionId = state.session?.session_id;
  if (retouchUI.session !== sessionId) {
    Object.assign(retouchUI, { session: sessionId, active: false, selected: null, points: null, cursor: null });
  }
  retouchInput("brush").setAttribute("aria-pressed", String(retouchUI.active));
  retouchInput("brush").disabled = !sessionId || retouchUI.busy;
  retouchInput("cancel").disabled = !retouchUI.busy;
  for (const name of ["size", "hardness", "search", "patch", "iterations", "seed"]) retouchInput(name).disabled = retouchUI.busy;
  const records = state.editDocument?.repairs || [];
  const selected = records.find(r => r.id === retouchUI.selected);
  retouchInput("apply").disabled = !selected || retouchUI.busy;
  retouchInput("retry").disabled = !selected || retouchUI.busy;
  const list = retouchInput("list");
  list.replaceChildren();
  for (const record of records) {
    const item = document.createElement("li");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = record.enabled;
    toggle.disabled = retouchUI.busy;
    toggle.setAttribute("aria-label", `Enable ${record.name}`);
    toggle.addEventListener("change", () => commitRetouch(records.map(r => r.id === record.id ? { ...r, enabled: toggle.checked } : r)));
    const choose = document.createElement("button");
    choose.type = "button";
    choose.textContent = record.name;
    choose.disabled = retouchUI.busy;
    choose.setAttribute("aria-pressed", String(record.id === retouchUI.selected));
    choose.addEventListener("click", () => {
      retouchUI.selected = record.id;
      const recipe = record.recipe;
      for (const [name, value] of Object.entries({ size: recipe.radius_px * 2, hardness: recipe.hardness * 100,
        search: Math.max(...[recipe.search_rect[2]-recipe.search_rect[0], recipe.search_rect[3]-recipe.search_rect[1]]),
        patch: recipe.settings.patch_radius, iterations: recipe.settings.iterations, seed: recipe.settings.seed })) {
        retouchInput(name).value = String(value);
      }
      retouchMessage("Selected repair. Change settings and Apply, or Retry with the next seed.");
      renderRetouchControls();
      renderLocalMaskOverlay();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.disabled = retouchUI.busy;
    remove.addEventListener("click", () => commitRetouch(records.filter(r => r.id !== record.id)));
    item.append(toggle, choose, remove);
    list.append(item);
  }
}

function retouchPoint(event) {
  const preview = activePreviewElement()?.getBoundingClientRect();
  const map = currentGeometryCoordinateMap();
  if (!preview || !map || event.clientX < preview.left || event.clientX > preview.right
      || event.clientY < preview.top || event.clientY > preview.bottom) return null;
  const point = projectivePoint(map.outputToSource, {
    x: (event.clientX - preview.left) / preview.width, y: (event.clientY - preview.top) / preview.height,
  });
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
  return { x: point.x, y: point.y, pressure: brushPointerPressure(event) };
}

function renderRetouchOverlay(canvas) {
  syncLocalMaskOverlayViewport();
  canvas.classList.add("editing");
  const rect = canvas.getBoundingClientRect(), image = activePreviewElement()?.getBoundingClientRect();
  if (!rect.width || !rect.height || !image) return;
  const ratio = window.devicePixelRatio || 1;
  const bitmapWidth = Math.max(1, Math.round(rect.width * ratio));
  const bitmapHeight = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
  if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  const draw = (points, color, lineWidth = 2) => {
    context.beginPath();
    points.forEach((point, index) => {
      const p = sourcePointToDisplay(point);
      if (!p) return;
      context[index ? "lineTo" : "moveTo"](image.left-rect.left+p.x*image.width, image.top-rect.top+p.y*image.height);
    });
    if (points.length === 1) {
      const p = sourcePointToDisplay(points[0]);
      if (p) context.arc(image.left-rect.left+p.x*image.width, image.top-rect.top+p.y*image.height, 4, 0, Math.PI*2);
    }
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
  };
  const selected = (state.editDocument?.repairs || []).find(r => r.id === retouchUI.selected);
  if (selected) draw(selected.recipe.points, "#ffd166");
  if (retouchUI.points) {
    const diameter = Number(retouchInput("size").value) * image.width / state.session.source.width;
    draw(retouchUI.points, "#ff405e99", Math.max(2, diameter));
  }
  const cursor = retouchUI.cursor;
  if (cursor && state.session) {
    const radius = Number(retouchInput("size").value) / 2;
    const width = state.session.source.width, height = state.session.source.height;
    if (Number.isFinite(radius)) draw(Array.from({ length: 33 }, (_, i) => ({
      x: cursor.x + Math.cos(i*Math.PI/16)*radius/width,
      y: cursor.y + Math.sin(i*Math.PI/16)*radius/height,
    })), "#ffffff");
  }
}

function bindRetouchEvents() {
  const canvas = els.localMaskOverlay;
  retouchInput("size").addEventListener("change", () => {
    constrainRetouchSize();
    queueLocalMaskOverlayRender();
  });
  retouchInput("brush").addEventListener("click", async () => {
    if (state.localPathDraft) await finishLocalPathDraft();
    retouchUI.active = !retouchUI.active;
    retouchUI.points = null;
    setGradeMode("local");
    await ensureGeometryCoordinateMap();
    renderRetouchControls();
    renderLocalMaskOverlay();
  });
  retouchInput("cancel").addEventListener("click", () => {
    retouchUI.cancelled = true;
    if (state.session) void fetch(`/api/session/${state.session.session_id}/retouch/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: retouchUI.requestId }) });
  });
  for (const name of ["apply", "retry"]) retouchInput(name).addEventListener("click", () => {
    const records = state.editDocument?.repairs || [], selected = records.find(r => r.id === retouchUI.selected);
    if (!selected) return;
    try {
      if (name === "retry") retouchInput("seed").value = String((Number(retouchInput("seed").value) + 1) >>> 0);
      const recipe = retouchRecipe(selected.recipe.points);
      void commitRetouch(records.map(r => r.id === selected.id ? { ...r, recipe } : r));
    } catch (error) { retouchMessage(error.message); }
  });
  const owns = () => retouchUI.active && state.gradeMode === "local" && state.activeWorkflow === "grade";
  canvas.addEventListener("pointerdown", event => {
    if (!owns() || event.button !== 0) return;
    event.stopImmediatePropagation();
    if (retouchUI.busy) return;
    const point = retouchPoint(event);
    if (!point) return;
    try { retouchValues(); } catch (error) { retouchMessage(error.message); return; }
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    retouchUI.points = [point];
    retouchUI.cursor = point;
    retouchMessage("Paint a small spot, then release to repair. Escape discards this stroke.");
    renderLocalMaskOverlay();
  }, true);
  canvas.addEventListener("pointermove", event => {
    if (!owns()) return;
    event.stopImmediatePropagation();
    const point = retouchPoint(event);
    retouchUI.cursor = point;
    if (point && retouchUI.points) {
      const last = retouchUI.points.at(-1), source = state.session.source;
      if (Math.hypot((point.x-last.x)*source.width, (point.y-last.y)*source.height) >= .5) {
        if (retouchUI.points.length >= 512) {
          retouchUI.points = null;
          retouchMessage("Stroke is too long. Paint several smaller repairs.");
        } else {
          retouchUI.points.push(point);
          try {
            retouchRecipe(retouchUI.points);
            retouchMessage("Release to repair this stroke. Escape discards it.");
          } catch (error) { retouchMessage(error.message); }
        }
      }
    }
    queueLocalMaskOverlayRender();
  }, true);
  canvas.addEventListener("pointerup", event => {
    if (!owns()) return;
    event.stopImmediatePropagation();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    const points = retouchUI.points;
    const end = retouchPoint(event);
    if (points && end && points.length < 512 && (end.x !== points.at(-1).x || end.y !== points.at(-1).y)) points.push(end);
    retouchUI.points = null;
    if (!points) return;
    try {
      const records = state.editDocument?.repairs || [], id = crypto.randomUUID();
      const record = { id, name: `Dust repair ${records.length+1}`, enabled: true, recipe: retouchRecipe(points) };
      retouchUI.selected = id;
      void commitRetouch([...records, record]);
    } catch (error) { retouchMessage(error.message); }
    renderLocalMaskOverlay();
  }, true);
  canvas.addEventListener("pointercancel", event => {
    if (!owns()) return;
    event.stopImmediatePropagation();
    retouchUI.points = null;
    renderLocalMaskOverlay();
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !retouchUI.active) return;
    retouchUI.points = null;
    if (retouchUI.busy) retouchInput("cancel").click();
    renderLocalMaskOverlay();
  });
}
