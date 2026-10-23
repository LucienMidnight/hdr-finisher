/* Native-source repair authoring. One completed gesture is one history edit. */
const retouchUI = { active: false, busy: false, cancelled: false, points: null, cursor: null, selected: null, session: null, mode: "inpaint", source: null, pickingSource: false };

const retouchMethods = {
  standard: { label: "Standard", help: "The current soft brush repair." },
  "edge-feather": { label: "Edge feather", help: "Prototype · full correction inside the brush, with a soft outer edge. Feather is the percentage of the radius used for that transition." },
  "original-detail": { label: "Original texture", help: "Prototype · corrects broad tone while preserving original fine texture. Best for luminance blotches; it can retain unwanted object outlines." },
  "donor-detail": { label: "Donor texture", help: "Prototype · replaces fine texture from nearby clean patches. Use for covered surfaces; repeating patterns may not align." },
};

function retouchInput(name) { return document.getElementById(`retouch-${name}`); }

function retouchMessage(message) { retouchInput("status").textContent = message; }

function constrainRetouchSize() {
  const input = retouchInput("size");
  const typed = Number(input.value);
  const size = input.value.trim() && Number.isFinite(typed)
    ? Math.min(1024, Math.max(1, typed)) : 12;
  if (input.value.trim() === "" || typed !== size) {
    input.value = String(size);
    retouchMessage(`Size set to ${size} native pixels. This prototype supports sizes from 1 to 1024.`);
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

function retouchRecipe(points) {
  const v = retouchValues();
  if (retouchUI.mode !== "inpaint" && !retouchUI.source) throw new Error("Alt-click the photo or use Set source before painting.");
  const width = state.session.source.width, height = state.session.source.height;
  const xs = points.map(p => p.x * width), ys = points.map(p => p.y * height);
  const axis = (values, length) => {
    const lower = Math.max(0, Math.floor(Math.min(...values) - v.radius));
    const upper = Math.min(length, Math.ceil(Math.max(...values) + v.radius));
    const edge = Math.min(length, Math.max(96, upper - lower + Math.max(32, Math.ceil(v.radius * 2))));
    if (edge > 2048) throw new Error("Paint this area in several shorter strokes.");
    const start = Math.max(0, Math.min(length - edge, Math.floor((lower + upper - edge) / 2)));
    return [start, start + edge];
  };
  const [left, right] = axis(xs, width), [top, bottom] = axis(ys, height);
  return { schema_version: 1, mode: retouchUI.mode, source_point: retouchUI.mode === "inpaint" ? null : retouchUI.source, strength: v.strength, raster_version: "native-capsules-v1",
    source_size: [width, height], search_rect: [left, top, right, bottom], points,
    radius_px: v.radius, hardness: v.hardness, method: v.method, edge_feather: v.feather, texture_amount: v.texture,
    donor_exclusions: (state.editDocument?.repairs || []).filter(r => r.enabled &&
      r.recipe.search_rect[0] < right && r.recipe.search_rect[2] > left &&
      r.recipe.search_rect[1] < bottom && r.recipe.search_rect[3] > top).map(r => ({
        points: r.recipe.points, radius_px: r.recipe.radius_px,
        hardness: r.recipe.mode === "inpaint" && r.recipe.method === "standard" ? r.recipe.hardness : 1-r.recipe.edge_feather,
      })),
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
    Object.assign(retouchUI, { session: sessionId, active: state.gradeMode === "retouch", selected: null, points: null, cursor: null, source: null, pickingSource: false });
  }
  retouchInput("brush").classList.toggle("active", retouchUI.active);
  retouchInput("brush").setAttribute("aria-pressed", String(retouchUI.active));
  retouchInput("brush").disabled = !sessionId || retouchUI.busy;
  retouchInput("brush-stop").disabled = !retouchUI.active || retouchUI.busy;
  retouchInput("cancel").disabled = !retouchUI.busy;
  for (const name of ["size", "hardness", "method", "feather", "texture", "opacity", "source-pick", "mode-inpaint", "mode-heal", "mode-clone"]) retouchInput(name).disabled = retouchUI.busy;
  retouchInput("source-pick").disabled = !sessionId || retouchUI.busy;
  const records = state.editDocument?.repairs || [];
  const selected = records.find(r => r.id === retouchUI.selected);
  // Restore accepted/history edits while preserving unapplied control changes.
  const accepted = selected ? `${selected.id}:${JSON.stringify(selected.recipe)}` : null;
  if (selected && accepted !== retouchUI.loadedRecipe) {
    const recipe = selected.recipe;
    retouchUI.mode = recipe.mode; retouchUI.source = recipe.source_point;
    retouchUI.pickingSource = false;
    for (const [name,value] of Object.entries({size:recipe.radius_px*2,hardness:recipe.hardness*100,
      method:recipe.method,feather:recipe.edge_feather*100,texture:recipe.texture_amount*100,opacity:recipe.strength*100})) retouchInput(name).value = String(value);
  }
  retouchUI.loadedRecipe = accepted;
  retouchInput("apply").disabled = retouchUI.busy || !selected;
  retouchInput("cancel").hidden = !retouchUI.busy;
  retouchInput("repair-count").textContent = `Repairs · ${records.length}`;
  syncRetouchReadouts();
  const list = retouchInput("list");
  list.replaceChildren();
  for (const record of [...records].reverse()) {
    const item = document.createElement("li");
    item.className = "local-adjustment-item";
    const choose = document.createElement("button");
    choose.type = "button";
    choose.className = "local-adjustment-select";
    choose.classList.toggle("active", record.id === retouchUI.selected);
    choose.append(createLocalAdjustmentCopy({ title: record.name, subtitle: `${record.recipe.radius_px * 2} px · ${record.recipe.mode === "inpaint" ? retouchMethods[record.recipe.method].label : record.recipe.mode === "heal" ? "Heal" : "Clone"}` }));
    choose.disabled = retouchUI.busy;
    choose.setAttribute("aria-pressed", String(record.id === retouchUI.selected));
    choose.addEventListener("click", () => {
      retouchUI.selected = record.id;
      const recipe = record.recipe;
      retouchUI.mode = recipe.mode;
      retouchUI.source = recipe.source_point;
      retouchUI.pickingSource = false;
      for (const [name, value] of Object.entries({ opacity: recipe.strength * 100, size: recipe.radius_px * 2, hardness: recipe.hardness * 100, method: recipe.method, feather: recipe.edge_feather * 100, texture: recipe.texture_amount * 100 })) {
        retouchInput(name).value = String(value);
      }
      retouchMessage(recipe.mode === "inpaint" ? "Selected repair. Change settings and apply them to compare methods; Retry tries another donor." : "Selected repair. Alt-click to change its source, then Apply settings.");
      renderRetouchControls();
      renderLocalMaskOverlay();
    });
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
      remove.addEventListener("click", () => commitRetouch(records.filter(r => r.id !== record.id)));
      item.append(remove);
    }
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
  if (selected) {
    draw(selected.recipe.points, "#ffd166");
    if (selected.recipe.mode !== "inpaint") {
      draw([selected.recipe.points[0], selected.recipe.source_point], "#ffd166", 1);
      draw([selected.recipe.source_point], "#ffd166");
    }
  }
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
    if (retouchUI.mode !== "inpaint" || retouchInput("method").value !== "standard") {
      const core = radius * (1-Number(retouchInput("feather").value)/100);
      if (core > 0 && core < radius) draw(Array.from({ length: 33 }, (_, i) => ({
        x: cursor.x + Math.cos(i*Math.PI/16)*core/width,
        y: cursor.y + Math.sin(i*Math.PI/16)*core/height,
      })), "#ffffff88", 1);
    }
    if (retouchUI.mode !== "inpaint" && retouchUI.source) {
      const start = retouchUI.points?.[0] || cursor;
      const source = { x: retouchUI.source.x + cursor.x-start.x, y: retouchUI.source.y + cursor.y-start.y };
      draw([cursor,source], "#66e0ff", 1);
      draw(Array.from({length:33},(_,i)=>({x:source.x+Math.cos(i*Math.PI/16)*radius/width,y:source.y+Math.sin(i*Math.PI/16)*radius/height})),"#66e0ff",1);
      draw([source],"#66e0ff");
    }
  }
}

function bindRetouchEvents() {
  const canvas = els.localMaskOverlay;
  for (const mode of ["inpaint", "heal", "clone"]) retouchInput(`mode-${mode}`).addEventListener("click", () => {
    retouchUI.mode = mode; retouchUI.points = null; retouchUI.pickingSource = false;
    renderRetouchControls(); renderLocalMaskOverlay();
    retouchMessage(mode === "inpaint" ? "Paint an area to repair it." : "Alt-click the photo or use Set source, then paint. Each stroke starts at the source.");
  });
  retouchInput("source-pick").addEventListener("click", async () => {
    retouchUI.active = true; retouchUI.pickingSource = true; retouchUI.points = null;
    await ensureGeometryCoordinateMap(); renderRetouchControls(); renderLocalMaskOverlay();
    retouchMessage("Click the source in the photo. Escape cancels source selection.");
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
  retouchInput("brush").addEventListener("click", async () => {
    if (state.localPathDraft) await finishLocalPathDraft();
    retouchUI.active = true;
    retouchUI.points = null;
    setGradeMode("retouch");
    await ensureGeometryCoordinateMap();
    renderRetouchControls();
    renderLocalMaskOverlay();
  });
  retouchInput("brush-stop").addEventListener("click", () => {
    retouchUI.active = false;
    retouchUI.pickingSource = false;
    retouchUI.points = null;
    retouchUI.cursor = null;
    renderRetouchControls();
    renderLocalMaskOverlay();
  });
  retouchInput("cancel").addEventListener("click", () => {
    retouchUI.cancelled = true;
    if (state.session) void fetch(`/api/session/${state.session.session_id}/retouch/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: retouchUI.requestId }) });
  });
  const owns = () => retouchUI.active && state.gradeMode === "retouch" && state.activeWorkflow === "grade";
  canvas.addEventListener("pointerdown", event => {
    if (!owns() || event.button !== 0) return;
    event.stopImmediatePropagation();
    if (retouchUI.busy) return;
    const point = retouchPoint(event);
    if (!point) return;
    if (retouchUI.mode !== "inpaint" && (event.altKey || retouchUI.pickingSource)) {
      event.preventDefault();
      retouchUI.source = {x:point.x,y:point.y,pressure:1};
      retouchUI.pickingSource = false; retouchUI.points = null; retouchUI.cursor = point;
      retouchMessage("Source set. Paint a new repair, or Apply settings to change the selected repair.");
      renderRetouchControls(); renderLocalMaskOverlay(); return;
    }
    if (retouchUI.mode !== "inpaint" && !retouchUI.source) { retouchMessage("Choose a source first: Alt-click the photo or use Set source."); return; }
    try { retouchValues(); } catch (error) { retouchMessage(error.message); return; }
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    retouchUI.points = [point];
    retouchUI.cursor = point;
    retouchMessage("Paint an area, then release to repair. Escape discards this stroke.");
    renderLocalMaskOverlay();
  }, true);
  canvas.addEventListener("pointermove", event => {
    if (!owns()) return;
    event.stopImmediatePropagation();
    const point = retouchPoint(event);
    retouchUI.cursor = point;
    if (point && retouchUI.points) {
      const last = retouchUI.points.at(-1), source = state.session.source;
      if (Math.hypot((point.x-last.x)*source.width, (point.y-last.y)*source.height) >= Math.max(.5, Number(retouchInput("size").value) * .025)) {
        if (retouchUI.points.length >= 512) {
          retouchUI.points = null;
          retouchMessage("Stroke is too long. Paint several smaller repairs.");
        } else {
          retouchUI.points.push(point);
          retouchMessage("Release to repair this stroke. Escape discards it.");
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
      const record = { id, name: `Spot ${records.length+1}`, enabled: true, recipe: retouchRecipe(points) };
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
    retouchUI.pickingSource = false;
    if (retouchUI.busy) retouchInput("cancel").click();
    renderRetouchControls();
    renderLocalMaskOverlay();
  });
}

function syncRetouchReadouts() {
  for (const [name, unit] of Object.entries({ size: " px", hardness: "%", feather: "%", texture: "%", opacity: "%" })) {
    retouchInput(`${name}-value`).textContent = `${Number(retouchInput(name).value)}${unit}`;
  }
  const method = retouchInput("method").value;
  const inpaint = retouchUI.mode === "inpaint";
  for (const mode of ["inpaint","heal","clone"]) {
    retouchInput(`mode-${mode}`).classList.toggle("active",retouchUI.mode===mode);
    retouchInput(`mode-${mode}`).setAttribute("aria-pressed",String(retouchUI.mode===mode));
  }
  retouchInput("source-controls").hidden = inpaint;
  retouchInput("inpaint-options").hidden = !inpaint;
  retouchInput("source-pick").textContent = retouchUI.pickingSource ? "Click source in photo…" : retouchUI.source ? "Change source" : "Set source";
  retouchInput("source-help").textContent = retouchUI.mode === "heal" ? "Prototype · copies source texture and matches the surrounding tone and colour. Alt-click to set source; each stroke starts there. Samples original pixels before grading." : "Copies original source pixels through the feathered brush. Alt-click to set source; each stroke starts there. Grading applies after copying.";
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
    const recipe = retouchRecipe(selected.recipe.points);
    recipe.donor_exclusions = selected.recipe.donor_exclusions || [];
    if (recipe.radius_px === selected.recipe.radius_px) recipe.search_rect = selected.recipe.search_rect;
    recipe.settings = { ...selected.recipe.settings,
      seed: retry ? (selected.recipe.settings.seed + 1) >>> 0 : selected.recipe.settings.seed };
    void commitRetouch(records.map(r => r.id === selected.id ? { ...r, recipe } : r));
  } catch (error) { retouchMessage(error.message); }
}
