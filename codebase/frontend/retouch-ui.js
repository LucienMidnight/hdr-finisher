/* Native-source repair authoring. One completed gesture is one history edit.
 *
 * Heal and Clone use two clicks: the first sets the source, the second makes
 * the repair (a drag paints a stroke). Shift keeps the source for the next
 * repair. The selected repair shows labelled Source and Destination circles;
 * dragging a circle, or holding Alt (source) or Ctrl/Cmd (destination), moves
 * it. */
const retouchUI = { active: false, busy: false, cancelled: false, points: null, cursor: null, selected: null, session: null, mode: "inpaint", source: null, brushes: {},
  gesture: null, hover: null, draft: null, modifier: null, pointerInside: false };

const retouchMethods = {
  standard: { label: "Standard", help: "The current soft brush repair." },
  "edge-feather": { label: "Edge feather", help: "Prototype · full correction inside the brush, with a soft outer edge. Feather is the percentage of the radius used for that transition." },
  "original-detail": { label: "Original texture", help: "Prototype · corrects broad tone while preserving original fine texture. Best for luminance blotches; it can retain unwanted object outlines." },
  "donor-detail": { label: "Donor texture", help: "Prototype · replaces fine texture from nearby clean patches. Use for covered surfaces; repeating patterns may not align." },
};

const retouchColors = { source: "#66e0ff", destination: "#ffb347", brush: "#ffffff" };
const retouchBrushFields = ["size", "hardness", "method", "feather", "texture", "opacity"];
const RETOUCH_DRAG_THRESHOLD = 4;
let retouchDefaults = null;
let retouchLayer = null;

function retouchInput(name) { return document.getElementById(`retouch-${name}`); }

function retouchMessage(message) { retouchInput("status").textContent = message; }

function retouchIsMac() { return navigator.platform.toLowerCase().includes("mac"); }

function retouchOwns() { return retouchUI.active && state.gradeMode === "retouch" && state.activeWorkflow === "grade"; }

function selectedRetouchRecord() { return (state.editDocument?.repairs || []).find(r => r.id === retouchUI.selected) || null; }

function retouchNeedsSource() { return retouchUI.mode !== "inpaint" && !retouchUI.source; }

function constrainRetouchSize() {
  const input = retouchInput("size");
  const typed = Number(input.value);
  const size = input.value.trim() && Number.isFinite(typed)
    ? Math.min(1024, Math.max(1, typed)) : 12;
  if (input.value.trim() === "" || typed !== size) {
    input.value = String(size);
    retouchMessage(`Size set to ${size} native pixels. Retouch supports sizes from 1 to 1024.`);
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
  return { strength: read("opacity", 0, 100, false) / 100, radius: read("size", 1, 1024, false) / 2, hardness: read("hardness", 0, 100, false) / 100,
    method: retouchInput("method").value, feather: read("feather", 0, 100, false) / 100,
    texture: read("texture", 0, 100, false) / 100, patch: 3, iterations: 6, seed: 20261021 };
}

function retouchSearchRect(points, radius) {
  const width = state.session.source.width, height = state.session.source.height;
  const axis = (values, length) => {
    const lower = Math.max(0, Math.floor(Math.min(...values) - radius));
    const upper = Math.min(length, Math.ceil(Math.max(...values) + radius));
    const edge = Math.min(length, Math.max(96, upper - lower + Math.max(32, Math.ceil(radius * 2))));
    if (edge > 2048) throw new Error("Paint this area in several shorter strokes.");
    const start = Math.max(0, Math.min(length - edge, Math.floor((lower + upper - edge) / 2)));
    return [start, start + edge];
  };
  const [left, right] = axis(points.map(p => p.x * width), width), [top, bottom] = axis(points.map(p => p.y * height), height);
  return [left, top, right, bottom];
}

function retouchDonorExclusions(records, [left, top, right, bottom]) {
  return records.filter(r => r.enabled &&
    r.recipe.search_rect[0] < right && r.recipe.search_rect[2] > left &&
    r.recipe.search_rect[1] < bottom && r.recipe.search_rect[3] > top).map(r => ({
      points: r.recipe.points, radius_px: r.recipe.radius_px,
      hardness: r.recipe.mode === "inpaint" && r.recipe.method === "standard" ? r.recipe.hardness : 1-r.recipe.edge_feather,
    }));
}

function retouchRecipe(points, options = {}) {
  const v = retouchValues();
  const mode = options.mode || retouchUI.mode;
  const source = "source" in options ? options.source : retouchUI.source;
  if (mode !== "inpaint" && !source) throw new Error("Click the photo to set a source first.");
  const width = state.session.source.width, height = state.session.source.height;
  const rect = retouchSearchRect(points, v.radius);
  return { schema_version: 1, mode, source_point: mode === "inpaint" ? null : source, strength: v.strength, raster_version: "native-capsules-v1",
    source_size: [width, height], search_rect: rect, points,
    radius_px: v.radius, hardness: v.hardness, method: v.method, edge_feather: v.feather, texture_amount: v.texture,
    donor_exclusions: retouchDonorExclusions(options.earlier || state.editDocument?.repairs || [], rect),
    settings: { patch_radius: v.patch, iterations: v.iterations, seed: v.seed, algorithm: "hdrf-patchmatch-cpu-v3" } };
}

async function commitRetouch(records) {
  if (retouchUI.busy || !state.session) return false;
  retouchUI.busy = true;
  retouchUI.cancelled = false;
  retouchUI.requestId = crypto.randomUUID();
  const sessionId = state.session.session_id;
  retouchMessage("Repairing area… the previous picture stays available. Escape cancels.");
  renderRetouchControls();
  try {
    const applied = await queueEditCommand("set_repairs", { repairs: records, repair_request_id: retouchUI.requestId }, null, { isCurrent: () => !retouchUI.cancelled });
    if (state.session?.session_id === sessionId) {
      retouchMessage(applied ? `Repair saved · shared by HDR and SDR.${retouchNextStepText()}` : "Repair was not applied. See the edit message; previous picture retained.");
    }
    return applied;
  } finally {
    retouchUI.busy = false;
    renderRetouchControls();
  }
}

function retouchNextStepText() {
  if (!retouchUI.active || retouchUI.mode === "inpaint") return "";
  return retouchUI.source ? " Click the next repair from the same source." : " Click a new source.";
}

function renderRetouchRoute() {
  if (typeof status === "undefined" || !status.post) return;
  const cpu=(state.session?.repair_rendering || []).filter(r=>r.renderer==="cpu");
  if (!cpu.length) { status.clear("retouch-route"); return; }
  const photo=state.session?.source?.filename || "Photo";
  const message=`${photo} · Retouch CPU fallback: ${cpu.map(r=>`${r.name} (${r.mode}): ${r.fallback_reason}`).join("; ")}`;
  if(status.get("retouch-route")?.message!==message)status.post({id:"retouch-route",severity:"attention",message,dismissible:false});
}

function currentRetouchBrushValues() {
  return Object.fromEntries(retouchBrushFields.map(name => [name, retouchInput(name).value]));
}

// Each tool keeps its own brush settings and next-repair source.
function switchRetouchMode(mode) {
  if (mode === retouchUI.mode) return;
  retouchUI.brushes[retouchUI.mode] = { values: currentRetouchBrushValues(), source: retouchUI.source ? {...retouchUI.source} : null };
  const brush = retouchUI.brushes[mode] || { values: retouchDefaults || currentRetouchBrushValues(), source: null };
  for (const name of retouchBrushFields) retouchInput(name).value = brush.values[name];
  retouchUI.mode = mode;
  retouchUI.source = brush.source ? {...brush.source} : null;
}

function renderRetouchControls() {
  renderRetouchRoute();
  if (!retouchInput("list")) return;
  const sessionId = state.session?.session_id;
  if (retouchUI.session !== sessionId) {
    Object.assign(retouchUI, { session: sessionId, active: state.gradeMode === "retouch", selected: null, points: null, cursor: null, source: null, brushes: {},
      gesture: null, hover: null, draft: null, modifier: null });
    // Every photo starts with Standard inpaint; saved repairs keep their own method.
    retouchInput("method").value = "standard";
  }
  retouchInput("cancel").disabled = !retouchUI.busy;
  for (const name of ["size", "hardness", "method", "feather", "texture", "opacity", "source-pick", "mode-inpaint", "mode-heal", "mode-clone"]) retouchInput(name).disabled = retouchUI.busy;
  retouchInput("source-pick").disabled = !sessionId || retouchUI.busy;
  const records = state.editDocument?.repairs || [];
  const selected = records.find(r => r.id === retouchUI.selected);
  // Restore accepted/history edits while preserving unapplied control changes.
  const accepted = selected ? `${selected.id}:${JSON.stringify(selected.recipe)}` : null;
  if (selected && accepted !== retouchUI.loadedRecipe) {
    const recipe = selected.recipe;
    switchRetouchMode(recipe.mode);
    for (const [name,value] of Object.entries({size:recipe.radius_px*2,hardness:recipe.hardness*100,
      method:recipe.method,feather:recipe.edge_feather*100,texture:recipe.texture_amount*100,opacity:recipe.strength*100})) retouchInput(name).value = String(value);
  }
  retouchUI.loadedRecipe = accepted;
  retouchInput("apply").disabled = retouchUI.busy || !selected;
  retouchInput("cancel").hidden = !retouchUI.busy;
  retouchInput("repair-count").textContent = `Repairs · ${records.length}`;
  syncRetouchReadouts();
  const list = retouchInput("list");
  const listFocused = list.contains(document.activeElement);
  retouchInput("empty").hidden = records.length > 0;
  list.replaceChildren();
  let selectedButton = null;
  for (const record of [...records].reverse()) {
    const item = document.createElement("li");
    item.className = "local-adjustment-item";
    const choose = document.createElement("button");
    choose.type = "button";
    choose.className = "local-adjustment-select";
    choose.dataset.repairId = record.id;
    choose.classList.toggle("active", record.id === retouchUI.selected);
    choose.append(createLocalAdjustmentCopy({ title: record.name, subtitle: `${record.recipe.radius_px * 2} px · ${record.recipe.mode === "inpaint" ? `Inpaint · ${retouchMethods[record.recipe.method].label}` : record.recipe.mode === "heal" ? "Heal" : "Clone"}` }));
    choose.disabled = retouchUI.busy;
    choose.setAttribute("aria-pressed", String(record.id === retouchUI.selected));
    choose.addEventListener("click", () => selectRetouchRepair(record.id));
    if (record.id === retouchUI.selected) selectedButton = choose;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "local-adjustment-bypass";
    toggle.classList.toggle("bypassed", !record.enabled);
    toggle.disabled = retouchUI.busy;
    toggle.setAttribute("aria-label", `${record.enabled ? "Hide" : "Show"} ${record.name}`);
    toggle.setAttribute("aria-pressed", String(!record.enabled));
    toggle.addEventListener("click", () => commitRetouch(records.map(r => r.id === record.id ? { ...r, enabled: !r.enabled } : r)));
    item.append(choose);
    if (record.id === retouchUI.selected && record.recipe.mode === "inpaint") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "↻";
      retry.title = "Try another repair";
      retry.setAttribute("aria-label", `Retry ${record.name}`);
      retry.disabled = retouchUI.busy;
      retry.addEventListener("click", retrySelectedRetouch);
      item.append(retry);
    }
    item.append(toggle);
    if (record.id === retouchUI.selected) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Remove repair";
      remove.setAttribute("aria-label", `Remove ${record.name}`);
      remove.disabled = retouchUI.busy;
      remove.addEventListener("click", removeSelectedRetouch);
      item.append(remove);
    }
    list.append(item);
  }
  if (selectedButton) {
    selectedButton.scrollIntoView({ block: "nearest" });
    if (listFocused) selectedButton.focus({ preventScroll: true });
  } else if (listFocused) list.focus({ preventScroll: true });
}

function selectRetouchRepair(id) {
  const record = (state.editDocument?.repairs || []).find(r => r.id === id);
  if (!record || retouchUI.busy) return;
  // Selecting a saved repair also restores its overlay and move controls.
  retouchUI.active = Boolean(state.session);
  retouchUI.selected = id;
  retouchUI.draft = null;
  retouchUI.loadedRecipe = null;
  retouchMessage(record.recipe.mode === "inpaint"
    ? "Selected repair. Drag it to move it, or change settings and apply them; Retry tries another donor."
    : "Selected repair. Drag either circle, or hold Alt (source) or Ctrl (destination) and click, to move it.");
  renderRetouchControls();
  renderLocalMaskOverlay();
}

function stepRetouchSelection(direction) {
  const shown = [...(state.editDocument?.repairs || [])].reverse();
  if (!shown.length) return;
  const index = shown.findIndex(r => r.id === retouchUI.selected);
  const next = index < 0 ? 0 : Math.max(0, Math.min(shown.length - 1, index + direction));
  selectRetouchRepair(shown[next].id);
}

function removeSelectedRetouch() {
  const records = state.editDocument?.repairs || [];
  if (!records.some(r => r.id === retouchUI.selected) || retouchUI.busy) return;
  void commitRetouch(records.filter(r => r.id !== retouchUI.selected));
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

/* ---- Moving a placed repair ---- */

function clampRetouchPoint(point) {
  return { ...point, x: Math.min(1, Math.max(0, point.x)), y: Math.min(1, Math.max(0, point.y)) };
}

// The positions a repair would have after moving one of its circles by (dx, dy).
function retouchMovedDraft(record, which, dx, dy) {
  const recipe = record.recipe;
  if (which === "source" && recipe.source_point) {
    return { points: recipe.points, source: clampRetouchPoint({ ...recipe.source_point, x: recipe.source_point.x + dx, y: recipe.source_point.y + dy }) };
  }
  const xs = recipe.points.map(p => p.x), ys = recipe.points.map(p => p.y);
  const mx = Math.min(1 - Math.max(...xs), Math.max(-Math.min(...xs), dx));
  const my = Math.min(1 - Math.max(...ys), Math.max(-Math.min(...ys), dy));
  return { points: recipe.points.map(p => ({ ...p, x: p.x + mx, y: p.y + my })), source: recipe.source_point };
}

// Alt places the source, Ctrl/Cmd the destination, under the pointer.
function retouchModifierDraft(record, modifier, point) {
  if (!record || !point) return null;
  if (modifier === "alt") {
    if (!record.recipe.source_point) return null;
    return retouchMovedDraft(record, "source", point.x - record.recipe.source_point.x, point.y - record.recipe.source_point.y);
  }
  return retouchMovedDraft(record, "destination", point.x - record.recipe.points[0].x, point.y - record.recipe.points[0].y);
}

function commitRetouchMove(draft) {
  const records = state.editDocument?.repairs || [];
  const index = records.findIndex(r => r.id === retouchUI.selected);
  if (index < 0 || !draft || retouchUI.busy) return;
  const old = records[index].recipe;
  const same = JSON.stringify(old.points) === JSON.stringify(draft.points) && JSON.stringify(old.source_point) === JSON.stringify(draft.source);
  if (same) return;
  try {
    // Only the position changes; the repair keeps its own settings and seed.
    const rect = retouchSearchRect(draft.points, old.radius_px);
    const recipe = { ...old, points: draft.points, source_point: old.mode === "inpaint" ? null : draft.source, search_rect: rect,
      donor_exclusions: retouchDonorExclusions(records.slice(0, index), rect) };
    void commitRetouch(records.map((r, i) => i === index ? { ...r, recipe } : r));
  } catch (error) { retouchMessage(error.message); }
}

function retouchModifierFromEvent(event) {
  if (event.altKey) return "alt";
  if (retouchIsMac() ? event.metaKey : event.ctrlKey) return "ctrl";
  return null;
}

/* ---- Overlay drawing ---- */

function retouchFrame(canvas) {
  const rect = canvas.getBoundingClientRect(), image = activePreviewElement()?.getBoundingClientRect();
  if (!rect.width || !rect.height || !image || !state.session) return null;
  return { rect, ox: image.left - rect.left, oy: image.top - rect.top, w: image.width, h: image.height, scale: image.width / state.session.source.width };
}

function retouchScreen(point, frame) {
  const p = sourcePointToDisplay(point);
  return p ? { x: frame.ox + p.x * frame.w, y: frame.oy + p.y * frame.h } : null;
}

// Source and destination footprints of a repair, with any pending move applied.
function retouchGizmo(recipe, draft) {
  const points = draft?.points || recipe.points;
  const source = recipe.mode === "inpaint" ? null : (draft?.source || recipe.source_point);
  const sourcePoints = source ? points.map(p => ({ ...p, x: p.x + source.x - points[0].x, y: p.y + source.y - points[0].y })) : null;
  return { points, sourcePoints, radius: recipe.radius_px };
}

function retouchHitTest(event) {
  const record = selectedRetouchRecord(), canvas = els.localMaskOverlay;
  if (!record || !canvas) return null;
  const frame = retouchFrame(canvas);
  if (!frame) return null;
  const gizmo = retouchGizmo(record.recipe, retouchUI.draft);
  const px = event.clientX - frame.rect.left, py = event.clientY - frame.rect.top;
  const reach = Math.max(6, gizmo.radius * frame.scale);
  const distance = points => Math.min(...points.map(p => {
    const s = retouchScreen(p, frame);
    return s ? Math.hypot(px - s.x, py - s.y) - reach : Infinity;
  }));
  const destination = distance(gizmo.points), source = gizmo.sourcePoints ? distance(gizmo.sourcePoints) : Infinity;
  if (Math.min(destination, source) > 0) return null;
  return source < destination ? "source" : "destination";
}

// Draws the outline of a brush footprint (circle or stroke) with a dark halo,
// so the ring stays visible on light and dark photos.
function drawRetouchShape(context, frame, points, radius, color, lineWidth = 1.5) {
  const screen = points.map(p => {
    const s = retouchScreen(p, frame);
    return s && { ...s, r: Math.max(1, radius * frame.scale * (p.pressure ?? 1)) };
  }).filter(Boolean);
  if (!screen.length) return;
  const canvas = context.canvas;
  retouchLayer ||= document.createElement("canvas");
  if (retouchLayer.width !== canvas.width) retouchLayer.width = canvas.width;
  if (retouchLayer.height !== canvas.height) retouchLayer.height = canvas.height;
  const layer = retouchLayer.getContext("2d");
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.globalCompositeOperation = "source-over";
  layer.clearRect(0, 0, retouchLayer.width, retouchLayer.height);
  layer.setTransform(context.getTransform());
  layer.lineCap = "round";
  layer.lineJoin = "round";
  const paint = (grow, style, composite = "source-over") => {
    layer.globalCompositeOperation = composite;
    layer.fillStyle = style;
    layer.strokeStyle = style;
    for (const s of screen) {
      if (s.r + grow <= 0) continue;
      layer.beginPath(); layer.arc(s.x, s.y, s.r + grow, 0, Math.PI * 2); layer.fill();
    }
    for (let i = 1; i < screen.length; i++) {
      const width = screen[i-1].r + screen[i].r + 2 * grow;
      if (width <= 0) continue;
      layer.lineWidth = width;
      layer.beginPath(); layer.moveTo(screen[i-1].x, screen[i-1].y); layer.lineTo(screen[i].x, screen[i].y); layer.stroke();
    }
  };
  const half = lineWidth / 2;
  paint(half + 1, "rgba(0,0,0,.55)");
  paint(half, color);
  paint(-half, "rgba(0,0,0,.55)");
  paint(-half - 1, "#000", "destination-out");
  layer.globalCompositeOperation = "source-over";
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(retouchLayer, 0, 0);
  context.restore();
}

// The line runs only between the two circle edges, never inside them.
function drawRetouchLink(context, frame, from, to, radius) {
  const a = retouchScreen(from, frame), b = retouchScreen(to, frame);
  if (!a || !b) return;
  const r = Math.max(1, radius * frame.scale), gap = r + 2;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length <= gap * 2 + 2) return;
  const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
  context.save();
  context.lineCap = "round";
  for (const [style, width] of [["rgba(0,0,0,.55)", 3], ["rgba(255,255,255,.85)", 1]]) {
    context.strokeStyle = style;
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(a.x + ux * gap, a.y + uy * gap);
    context.lineTo(b.x - ux * gap, b.y - uy * gap);
    context.stroke();
  }
  context.restore();
}

// Labels grow with the circle as you zoom, through the type tokens (11–16 px).
function drawRetouchLabel(context, frame, point, radius, text, color, below) {
  const s = retouchScreen(point, frame);
  if (!s) return;
  const r = Math.max(1, radius * frame.scale);
  const token = r < 12 ? "min" : r < 30 ? "xs" : r < 60 ? "sm" : r < 100 ? "md" : "lg";
  const font = HDRAppearance.font(token, "body", "semibold");
  const size = Number(font.match(/([\d.]+)px/)?.[1]) || 12;
  let y = below ? s.y + r + 4 : s.y - r - 4;
  if (!below && y - size < 0) { below = true; y = s.y + r + 4; }
  if (below && y + size > frame.rect.height) { below = false; y = s.y - r - 4; }
  context.save();
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = below ? "top" : "bottom";
  context.lineJoin = "round";
  context.lineWidth = 3;
  context.strokeStyle = "rgba(0,0,0,.75)";
  context.strokeText(text, s.x, y);
  context.fillStyle = color;
  context.fillText(text, s.x, y);
  context.restore();
}

// Each label sits on the side away from the other circle.
function drawRetouchPair(context, frame, points, sourcePoints, radius, emphasis = {}) {
  drawRetouchShape(context, frame, points, radius, retouchColors.destination, emphasis.destination ? 3 : 1.5);
  if (sourcePoints) {
    drawRetouchLink(context, frame, sourcePoints[0], points[0], radius);
    drawRetouchShape(context, frame, sourcePoints, radius, retouchColors.source, emphasis.source ? 3 : 1.5);
    const sourceAbove = sourcePoints[0].y <= points[0].y;
    drawRetouchLabel(context, frame, sourcePoints[0], radius, "Source", retouchColors.source, !sourceAbove);
    drawRetouchLabel(context, frame, points[0], radius, "Destination", retouchColors.destination, sourceAbove);
  } else {
    drawRetouchLabel(context, frame, points[0], radius, "Destination", retouchColors.destination, false);
  }
}

function retouchCircle(center, radius, width, height) {
  return Array.from({ length: 33 }, (_, i) => ({
    x: center.x + Math.cos(i*Math.PI/16)*radius/width,
    y: center.y + Math.sin(i*Math.PI/16)*radius/height,
  }));
}

function renderRetouchOverlay(canvas) {
  syncLocalMaskOverlayViewport();
  canvas.classList.add("editing");
  const frame = retouchFrame(canvas);
  updateRetouchCursor();
  if (!frame) return;
  const { rect } = frame;
  const ratio = window.devicePixelRatio || 1;
  const bitmapWidth = Math.max(1, Math.round(rect.width * ratio));
  const bitmapHeight = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
  if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  const line = (points, color, lineWidth = 2) => {
    context.beginPath();
    points.forEach((point, index) => {
      const p = retouchScreen(point, frame);
      if (p) context[index ? "lineTo" : "moveTo"](p.x, p.y);
    });
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
  };
  const selected = selectedRetouchRecord();
  if (selected) {
    const gizmo = retouchGizmo(selected.recipe, retouchUI.draft);
    const active = retouchUI.gesture?.moved ? retouchUI.gesture.hit
      : retouchUI.modifier === "alt" ? "source" : retouchUI.modifier === "ctrl" ? "destination" : retouchUI.hover;
    drawRetouchPair(context, frame, gizmo.points, gizmo.sourcePoints, gizmo.radius, { [active]: true });
  }
  const radius = Number(retouchInput("size").value) / 2;
  if (!Number.isFinite(radius) || !state.session) return;
  if (retouchUI.points) {
    const diameter = radius * 2 * frame.scale;
    line(retouchUI.points, "#ff405e99", Math.max(2, diameter));
  }
  const cursor = retouchUI.cursor;
  // A held modifier or a hovered circle replaces the brush ring.
  if (!cursor || (selected && retouchUI.modifier && retouchModifierDraft(selected, retouchUI.modifier, cursor))) return;
  if (!retouchUI.gesture && retouchUI.hover) return;
  if (retouchUI.gesture?.hit && retouchUI.gesture.moved) return;
  const width = state.session.source.width, height = state.session.source.height;
  const picking = retouchNeedsSource() || (retouchUI.mode !== "inpaint" && retouchUI.modifier === "alt");
  const color = retouchUI.mode === "inpaint" ? retouchColors.brush : picking ? retouchColors.source : retouchColors.destination;
  line(retouchCircle(cursor, radius, width, height), color);
  if (retouchUI.mode !== "inpaint" || retouchInput("method").value !== "standard") {
    const core = radius * (1-Number(retouchInput("feather").value)/100);
    if (core > 0 && core < radius) line(retouchCircle(cursor, core, width, height), `${color}88`, 1);
  }
  if (retouchUI.mode === "inpaint") return;
  if (picking) {
    drawRetouchLabel(context, frame, cursor, radius, "Source", retouchColors.source, false);
    return;
  }
  const start = retouchUI.points?.[0] || cursor;
  const source = { x: retouchUI.source.x + cursor.x-start.x, y: retouchUI.source.y + cursor.y-start.y };
  drawRetouchLink(context, frame, source, cursor, radius);
  line(retouchCircle(source, radius, width, height), retouchColors.source, 1.5);
  const sourceAbove = source.y <= cursor.y;
  drawRetouchLabel(context, frame, source, radius, "Source", retouchColors.source, !sourceAbove);
  drawRetouchLabel(context, frame, cursor, radius, "Destination", retouchColors.destination, sourceAbove);
}

function updateRetouchCursor() {
  const canvas = els.localMaskOverlay;
  if (!canvas) return;
  const cursor = retouchUI.gesture?.hit && retouchUI.gesture.moved ? "grabbing"
    : !retouchUI.gesture && !retouchUI.modifier && retouchUI.hover ? "grab" : "";
  if ((canvas.dataset.retouchCursor || "") !== cursor) {
    if (cursor) canvas.dataset.retouchCursor = cursor;
    else delete canvas.dataset.retouchCursor;
  }
}

/* ---- Status bar keys ---- */

function retouchKeyHints() {
  if (!retouchOwns()) return null;
  const mod = retouchIsMac() ? "⌘" : "Ctrl";
  const selected = selectedRetouchRecord();
  if (retouchUI.hover || retouchUI.gesture?.hit) {
    return [["Drag", "move"], ["Del", "remove"], ["↑↓", "repairs"], ["Esc", "deselect"]];
  }
  if (retouchUI.mode === "inpaint") {
    return [["Click or drag", "repair"], ["[ ]", "size"], ["↑↓", "repairs"], ["Esc", selected ? "deselect" : "stop"]];
  }
  if (!retouchUI.source) {
    return [["Click", "source"], ["Alt", "move source"], [mod, "move destination"], ["↑↓", "repairs"]];
  }
  return [["Click", "repair"], ["Shift-click", "keep source"], ["Drag", "paint"], ["Esc", "cancel"]];
}

/* ---- Events ---- */

function setRetouchModifier(modifier) {
  if (retouchUI.modifier === modifier) return;
  retouchUI.modifier = modifier;
  const selected = selectedRetouchRecord();
  retouchUI.draft = modifier && !retouchUI.gesture ? retouchModifierDraft(selected, modifier, retouchUI.cursor) : (retouchUI.gesture ? retouchUI.draft : null);
  queueLocalMaskOverlayRender();
}

function retouchEscape() {
  if (retouchUI.busy) { retouchInput("cancel").click(); return; }
  if (retouchUI.gesture || retouchUI.points || retouchUI.draft) {
    retouchUI.gesture = null; retouchUI.points = null; retouchUI.draft = null;
  } else if (retouchUI.mode !== "inpaint" && retouchUI.source) {
    retouchUI.source = null;
    retouchMessage("Source cleared. Click the photo to set a new source.");
  } else if (retouchUI.selected) {
    retouchUI.selected = null;
  } else {
    retouchUI.active = false;
    retouchUI.cursor = null;
    retouchUI.hover = null;
  }
  renderRetouchControls();
  renderLocalMaskOverlay();
}

function resizeRetouchBrush(direction) {
  const input = retouchInput("size");
  const size = Number(input.value) || 12;
  const next = direction > 0 ? Math.min(1024, Math.max(size + 1, Math.round(size * 1.1)))
    : Math.max(1, Math.min(size - 1, Math.round(size / 1.1)));
  input.value = String(next);
  syncRetouchReadouts();
  queueLocalMaskOverlayRender();
}

function createRetouchRepair(points, keepSource) {
  try {
    const records = state.editDocument?.repairs || [], id = crypto.randomUUID();
    const record = { id, name: `Spot ${records.length+1}`, enabled: true, recipe: retouchRecipe(points) };
    retouchUI.selected = id;
    // The next click picks a new source unless Shift kept this one.
    if (retouchUI.mode !== "inpaint" && !keepSource) retouchUI.source = null;
    void commitRetouch([...records, record]);
  } catch (error) { retouchMessage(error.message); }
}

function bindRetouchEvents() {
  const canvas = els.localMaskOverlay;
  // Creation tools own independent brush drafts. A saved row is edited only
  // after selecting it; choosing any tool always begins a fresh repair.
  retouchDefaults = currentRetouchBrushValues();
  for (const mode of ["inpaint", "heal", "clone"]) retouchInput(`mode-${mode}`).addEventListener("click", async () => {
    // Clicking the lit tool turns it off; any other choice starts that tool.
    if (retouchUI.active && retouchUI.mode === mode && state.gradeMode === "retouch") {
      Object.assign(retouchUI, { active: false, points: null, cursor: null, hover: null, gesture: null, draft: null });
      renderRetouchControls(); renderLocalMaskOverlay();
      retouchMessage("Tool off. Choose a repair tool to continue.");
      return;
    }
    switchRetouchMode(mode);
    retouchUI.selected = null; retouchUI.loadedRecipe = null;
    Object.assign(retouchUI, { points: null, gesture: null, hover: null, draft: null });
    if (state.localPathDraft) await finishLocalPathDraft();
    if (state.gradeMode !== "retouch") setGradeMode("retouch");
    retouchUI.active = Boolean(state.session);
    await ensureGeometryCoordinateMap();
    renderRetouchControls(); renderLocalMaskOverlay();
    retouchMessage(mode === "inpaint" ? "Click or paint a new Inpaint repair." : retouchUI.source
      ? `New ${mode === "heal" ? "Heal" : "Clone"} repair. Click the area to repair.`
      : `New ${mode === "heal" ? "Heal" : "Clone"} repair. Click the source, then click the area to repair.`);
  });
  retouchInput("source-pick").addEventListener("click", async () => {
    retouchUI.active = Boolean(state.session); retouchUI.source = null; retouchUI.points = null;
    await ensureGeometryCoordinateMap(); renderRetouchControls(); renderLocalMaskOverlay();
    retouchMessage("Click the source in the photo.");
  });
  retouchInput("size").addEventListener("change", () => {
    constrainRetouchSize();
    queueLocalMaskOverlayRender();
  });
  retouchInput("method").addEventListener("change", () => {
    syncRetouchReadouts();
    queueLocalMaskOverlayRender();
  });
  retouchInput("apply").addEventListener("click", () => applySelectedRetouch(false));
  for (const name of ["size", "hardness", "feather", "texture", "opacity"]) {
    retouchInput(name).addEventListener("input", () => {
      syncRetouchReadouts();
      queueLocalMaskOverlayRender();
    });
    retouchInput(name).addEventListener("change", syncRetouchReadouts);
  }
  bindSliderReadouts(document.querySelector(".retouch-panel"));
  retouchInput("cancel").addEventListener("click", () => {
    retouchUI.cancelled = true;
    if (state.session) void fetch(`/api/session/${state.session.session_id}/retouch/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: retouchUI.requestId }) });
  });
  const list = retouchInput("list");
  list.addEventListener("keydown", event => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      stepRetouchSelection(event.key === "ArrowDown" ? 1 : -1);
    } else if ((event.key === "Delete" || event.key === "Backspace") && retouchUI.selected) {
      event.preventDefault();
      removeSelectedRetouch();
    } else if (event.key === "Escape" && retouchUI.selected) {
      event.preventDefault();
      event.stopPropagation();
      retouchUI.selected = null;
      renderRetouchControls(); renderLocalMaskOverlay();
    }
  });
  canvas.addEventListener("pointerdown", event => {
    if (!retouchOwns() || event.button !== 0) return;
    event.stopImmediatePropagation();
    if (retouchUI.busy) return;
    const point = retouchPoint(event);
    if (!point) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    retouchUI.cursor = point;
    const modifier = retouchModifierFromEvent(event), selected = selectedRetouchRecord();
    // Alt/Ctrl-click moves the selected repair's source/destination.
    if (modifier && selected && (modifier === "ctrl" || selected.recipe.mode !== "inpaint")) {
      const draft = retouchModifierDraft(selected, modifier, point);
      retouchUI.draft = null;
      commitRetouchMove(draft);
      renderLocalMaskOverlay();
      return;
    }
    if (modifier === "alt" && retouchUI.mode !== "inpaint") {
      retouchUI.source = { x: point.x, y: point.y, pressure: 1 };
      retouchUI.points = null;
      retouchMessage("Source set. Click the area to repair, or drag to paint.");
      renderRetouchControls(); renderLocalMaskOverlay(); return;
    }
    const hit = retouchHitTest(event);
    if (!hit && !retouchNeedsSource()) {
      try { retouchValues(); } catch (error) { retouchMessage(error.message); return; }
      retouchUI.points = [point];
      retouchMessage("Release to repair. Drag to paint a stroke; Escape discards it.");
    }
    retouchUI.gesture = { start: point, startX: event.clientX, startY: event.clientY, hit, shift: event.shiftKey, moved: false };
    canvas.setPointerCapture(event.pointerId);
    renderLocalMaskOverlay();
  }, true);
  canvas.addEventListener("pointermove", event => {
    if (!retouchOwns()) return;
    event.stopImmediatePropagation();
    retouchUI.pointerInside = true;
    const point = retouchPoint(event);
    retouchUI.cursor = point;
    const gesture = retouchUI.gesture;
    if (gesture) {
      if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= RETOUCH_DRAG_THRESHOLD) gesture.moved = true;
      if (gesture.hit && gesture.moved && point) {
        retouchUI.draft = retouchMovedDraft(selectedRetouchRecord(), gesture.hit, point.x - gesture.start.x, point.y - gesture.start.y);
      } else if (!gesture.hit && point && retouchUI.points && gesture.moved) {
        const last = retouchUI.points.at(-1), source = state.session.source;
        if (Math.hypot((point.x-last.x)*source.width, (point.y-last.y)*source.height) >= Math.max(.5, Number(retouchInput("size").value) * .025)) {
          if (retouchUI.points.length >= 512) {
            retouchUI.points = null;
            retouchUI.gesture = null;
            retouchMessage("Stroke is too long. Paint several smaller repairs.");
          } else {
            retouchUI.points.push(point);
            retouchMessage("Release to repair this stroke. Escape discards it.");
          }
        }
      }
    } else {
      setRetouchModifier(retouchModifierFromEvent(event));
      if (retouchUI.modifier) retouchUI.draft = retouchModifierDraft(selectedRetouchRecord(), retouchUI.modifier, point);
      retouchUI.hover = retouchUI.modifier ? null : retouchHitTest(event);
    }
    queueLocalMaskOverlayRender();
  }, true);
  canvas.addEventListener("pointerup", event => {
    if (!retouchOwns()) return;
    event.stopImmediatePropagation();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    const gesture = retouchUI.gesture;
    retouchUI.gesture = null;
    let points = retouchUI.points;
    retouchUI.points = null;
    if (!gesture) { renderLocalMaskOverlay(); return; }
    if (gesture.hit && gesture.moved) {
      const draft = retouchUI.draft;
      retouchUI.draft = null;
      commitRetouchMove(draft);
      renderLocalMaskOverlay();
      return;
    }
    // A press that did not drag is a click, even on top of a circle.
    if (retouchNeedsSource()) {
      retouchUI.source = { x: gesture.start.x, y: gesture.start.y, pressure: 1 };
      retouchMessage("Source set. Click the area to repair, or drag to paint. Shift-click keeps this source.");
      renderRetouchControls(); renderLocalMaskOverlay();
      return;
    }
    if (!gesture.moved || !points) points = [gesture.start];
    else {
      const end = retouchPoint(event);
      if (end && points.length < 512 && (end.x !== points.at(-1).x || end.y !== points.at(-1).y)) points.push(end);
    }
    createRetouchRepair(points, gesture.shift);
    renderLocalMaskOverlay();
  }, true);
  canvas.addEventListener("pointercancel", event => {
    if (!retouchOwns()) return;
    event.stopImmediatePropagation();
    Object.assign(retouchUI, { points: null, gesture: null, draft: null });
    renderLocalMaskOverlay();
  }, true);
  canvas.addEventListener("pointerenter", () => { retouchUI.pointerInside = true; });
  canvas.addEventListener("pointerleave", () => {
    retouchUI.pointerInside = false;
    if (!retouchOwns() || retouchUI.gesture) return;
    Object.assign(retouchUI, { cursor: null, hover: null, draft: null, modifier: null });
    queueLocalMaskOverlayRender();
  });
  const typing = target => target instanceof HTMLInputElement || target instanceof HTMLSelectElement
    || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  document.addEventListener("keydown", event => {
    if (!retouchOwns()) return;
    if (["Alt", "Control", "Meta"].includes(event.key)) {
      if (event.key === "Alt") event.preventDefault();
      if (retouchUI.pointerInside && !retouchUI.gesture) setRetouchModifier(retouchModifierFromEvent(event));
      return;
    }
    if (typing(event.target) || event.defaultPrevented) return;
    if (retouchInput("list").contains(event.target)) return;
    const onPhoto = retouchUI.pointerInside || event.target === canvas || event.target === document.body;
    if (event.key === "Escape") { event.preventDefault(); retouchEscape(); return; }
    if (!onPhoto || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      stepRetouchSelection(event.key === "ArrowDown" ? 1 : -1);
    } else if ((event.key === "Delete" || event.key === "Backspace") && selectedRetouchRecord()) {
      event.preventDefault();
      removeSelectedRetouch();
    } else if (event.key === "[" || event.key === "]") {
      event.preventDefault();
      resizeRetouchBrush(event.key === "]" ? 1 : -1);
    }
  });
  document.addEventListener("keyup", event => {
    if (!retouchOwns() || !["Alt", "Control", "Meta"].includes(event.key)) return;
    if (event.key === "Alt") event.preventDefault();
    // Releasing the key without clicking puts the circle back.
    if (!retouchUI.gesture) setRetouchModifier(retouchModifierFromEvent(event));
  });
  window.addEventListener("blur", () => {
    if (!retouchUI.modifier) return;
    retouchUI.modifier = null;
    if (!retouchUI.gesture) retouchUI.draft = null;
    queueLocalMaskOverlayRender();
  });
  if (typeof keyHints !== "undefined") keyHints.register(retouchKeyHints);
}

function syncRetouchReadouts() {
  for (const [name, unit] of Object.entries({ size: " px", hardness: "%", feather: "%", texture: "%", opacity: "%" })) {
    retouchInput(`${name}-value`).textContent = `${Number(retouchInput(name).value)}${unit}`;
  }
  const method = retouchInput("method").value;
  const inpaint = retouchUI.mode === "inpaint";
  for (const mode of ["inpaint","heal","clone"]) {
    const lit = retouchUI.active && retouchUI.mode === mode;
    retouchInput(`mode-${mode}`).classList.toggle("active", lit);
    retouchInput(`mode-${mode}`).setAttribute("aria-pressed", String(lit));
  }
  retouchInput("source-controls").hidden = inpaint;
  retouchInput("inpaint-options").hidden = !inpaint;
  retouchInput("source-pick").textContent = retouchUI.source ? "Change source" : "Set source";
  retouchInput("source-help").textContent = retouchUI.mode === "heal"
    ? "Prototype · copies source texture and matches the surrounding tone and colour. Click the source, then click or drag over the area to repair; Shift-click keeps the source. Samples original pixels before grading."
    : "Copies original source pixels through the feathered brush. Click the source, then click or drag over the area to repair; Shift-click keeps the source. Grading applies after copying.";
  retouchInput("hardness-row").hidden = !inpaint || method !== "standard";
  retouchInput("prototype-controls").hidden = inpaint && method === "standard";
  retouchInput("texture-row").hidden = !inpaint || !["original-detail", "donor-detail"].includes(method);
  retouchInput("method-help").textContent = retouchMethods[method].help;
  syncRangeVisuals(document.querySelector(".retouch-panel"));
}

function retrySelectedRetouch() { return applySelectedRetouch(true); }

function applySelectedRetouch(retry) {
  const records = state.editDocument?.repairs || [], selected = records.find(r => r.id === retouchUI.selected);
  if (!selected || retouchUI.busy) return;
  try {
    const recipe = retouchRecipe(selected.recipe.points, { mode: selected.recipe.mode, source: selected.recipe.source_point });
    recipe.donor_exclusions = selected.recipe.donor_exclusions || [];
    if (recipe.radius_px === selected.recipe.radius_px) recipe.search_rect = selected.recipe.search_rect;
    recipe.settings = { ...selected.recipe.settings,
      seed: retry ? (selected.recipe.settings.seed + 1) >>> 0 : selected.recipe.settings.seed };
    void commitRetouch(records.map(r => r.id === selected.id ? { ...r, recipe } : r));
  } catch (error) { retouchMessage(error.message); }
}
