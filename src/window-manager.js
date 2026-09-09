/**
 * Window lifecycle, four workspaces and responsive i3 tiling.
 * App render(body, options, window) may return a cleanup function.
 * Public window arguments and getWindows() use the actual .window DOM nodes.
 */
export function createWindowManager({ layer, taskbar, apps, system, toast = () => {}, closeLauncher = () => {}, onWindowsChange = () => {} }) {
  if (!layer || !taskbar) throw new Error("Fönsterlagret och aktivitetsfältet saknas.");

  const doc = layer.ownerDocument;
  const view = doc.defaultView;
  const lifetime = new AbortController();
  const records = new Map();
  const workspaceBar = doc.querySelector("#workspaces");
  let workspace = 1, sequence = 0, highestZ = 10, focused = null;
  let layoutFrame = 0, destroyed = false, gesture = null, lastLayoutMode = null;
  let cycle = null;
  const mode = () => doc.body.dataset.desktop || system?.state?.settings?.desktop || "plasma";
  const isTiled = () => mode() === "i3";
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const currentRecords = () => [...records.values()].filter(record => record.workspace === workspace);
  const visibleRecords = () => currentRecords().filter(record => !record.minimized);

  function setAppIcon(element, app) {
    if (!app.iconId) { element.textContent = app.icon || "◇"; return; }
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "app-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("aria-hidden", "true");
    const use = doc.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `${new URL("../assets/icons.svg", import.meta.url).href}#${app.iconId}`);
    svg.append(use);
    element.append(svg);
  }

  function bounds() {
    const rect = layer.getBoundingClientRect();
    const width = Math.max(1, layer.clientWidth || rect.width);
    const height = Math.max(1, layer.clientHeight || rect.height);
    const gap = width < 480 || height < 300 ? 3 : 8;
    return { width, height, gap, left: rect.left, top: rect.top };
  }

  function clampRect(rect) {
    const area = bounds();
    const maxWidth = Math.max(1, area.width - area.gap * 2);
    const maxHeight = Math.max(1, area.height - area.gap * 2);
    const width = clamp(rect.width, Math.min(300, maxWidth), maxWidth);
    const height = clamp(rect.height, Math.min(200, maxHeight), maxHeight);
    return {
      width, height,
      left: clamp(rect.left, area.gap, Math.max(area.gap, area.width - width - area.gap)),
      top: clamp(rect.top, area.gap, Math.max(area.gap, area.height - height - area.gap))
    };
  }

  function setRect(record, rect) {
    for (const key of ["left", "top", "width", "height"]) record.win.style[key] = `${Math.round(rect[key])}px`;
  }

  function updateWorkspaceBar() {
    workspaceBar?.querySelectorAll("[data-workspace]").forEach(button => {
      const number = Number(button.dataset.workspace);
      const count = [...records.values()].filter(record => record.workspace === number).length;
      button.classList.toggle("active", number === workspace);
      button.setAttribute("aria-pressed", String(number === workspace));
      button.dataset.occupied = String(count);
      button.classList.toggle("occupied", count > 0);
      button.title = `Skrivbord ${number} · ${count} fönster · Ctrl+Alt+${number}`;
      button.setAttribute("aria-label", `Skrivbord ${number}, ${count} fönster`);
    });
    doc.body.dataset.workspace = String(workspace);
  }

  function notify() {
    updateWorkspaceBar();
    onWindowsChange({ workspace, windows: getWindows(), mode: mode() });
  }

  function syncVisibility() {
    const fullTile = isTiled() ? visibleRecords().find(record => record.maximized) : null;
    for (const record of records.values()) {
      const local = record.workspace === workspace;
      const hidden = !local || record.minimized || Boolean(fullTile && record !== fullTile);
      record.win.hidden = hidden;
      record.win.inert = hidden;
      record.task.hidden = !local;
      record.win.classList.toggle("minimized", record.minimized);
      record.win.classList.toggle("maximized", record.maximized);
      record.win.classList.toggle("tiled", isTiled());
      const active = record.win === focused && !hidden;
      record.win.classList.toggle("focused", active);
      record.task.classList.toggle("active", active);
      record.task.classList.toggle("minimized", record.minimized);
      record.task.setAttribute("aria-pressed", String(active));
      record.resizeHandle.hidden = isTiled() || record.maximized;
      record.maxButton.setAttribute("aria-label", record.maximized ? "Återställ fönster" : "Maximera");
      record.maxButton.title = record.maximized ? "Återställ" : "Maximera";
      record.maxButton.textContent = record.maximized ? "❐" : "□";
    }
  }

  /** Recompute geometry after a theme change; ResizeObserver also handles viewport changes. */
  function applyLayout() {
    if (destroyed) return;
    if (lastLayoutMode !== null && lastLayoutMode !== mode()) stopGesture();
    lastLayoutMode = mode();
    const area = bounds();
    const usable = { left: area.gap, top: area.gap, width: Math.max(1, area.width - area.gap * 2), height: Math.max(1, area.height - area.gap * 2) };
    const tiled = isTiled();
    for (const record of records.values()) {
      record.rect = clampRect(record.rect);
      if (!tiled) setRect(record, record.maximized ? usable : record.rect);
    }
    if (tiled) {
      const windows = visibleRecords();
      const full = windows.find(record => record.maximized);
      if (full) setRect(full, usable);
      else if (windows.length === 1) setRect(windows[0], usable);
      else if (windows.length > 1 && area.width >= 840 && windows.length <= 4) {
        const masterWidth = Math.floor((usable.width - area.gap) * .56);
        setRect(windows[0], { ...usable, width: masterWidth });
        const stackHeight = (usable.height - area.gap * (windows.length - 2)) / (windows.length - 1);
        windows.slice(1).forEach((record, index) => setRect(record, {
          left: usable.left + masterWidth + area.gap,
          top: usable.top + index * (stackHeight + area.gap),
          width: usable.width - masterWidth - area.gap,
          height: stackHeight
        }));
      } else if (windows.length > 1) {
        const columns = Math.min(windows.length, Math.max(1, Math.floor(usable.width / 300)));
        const rows = Math.ceil(windows.length / columns);
        const width = Math.max(1, (usable.width - area.gap * (columns - 1)) / columns);
        const height = Math.max(1, (usable.height - area.gap * (rows - 1)) / rows);
        windows.forEach((record, index) => setRect(record, {
          left: usable.left + (index % columns) * (width + area.gap),
          top: usable.top + Math.floor(index / columns) * (height + area.gap),
          width, height
        }));
      }
    }
    syncVisibility();
    updateWorkspaceBar();
  }

  function queueLayout() {
    if (!layoutFrame && !destroyed) layoutFrame = view.requestAnimationFrame(() => { layoutFrame = 0; stopGesture(); applyLayout(); });
  }

  function focusContent(record) {
    const previous = record.lastFocused;
    const target = previous?.isConnected && record.win.contains(previous)
      ? previous
      : record.win.querySelector(".window-body input:not([disabled]), .window-body textarea:not([disabled]), .window-body [contenteditable=true], .window-body [tabindex='0']") || record.win;
    target.focus({ preventScroll: true });
  }

  function focusWindow(win, { focusContent: shouldFocus = true, preserveCycle = false } = {}) {
    const record = records.get(win);
    if (!record) return;
    if (!preserveCycle) cycle = null;
    if (record.workspace !== workspace) switchWorkspace(record.workspace, { focus: false });
    record.minimized = false;
    if (isTiled()) currentRecords().forEach(other => { if (other !== record) other.maximized = false; });
    focused = win;
    if (highestZ >= 9000) {
      [...records.values()].sort((a, b) => a.z - b.z).forEach((other, index) => {
        other.z = index + 10;
        other.win.style.zIndex = String(other.z);
      });
      highestZ = records.size + 10;
    }
    record.z = ++highestZ;
    win.style.zIndex = String(record.z);
    applyLayout();
    if (shouldFocus) focusContent(record);
    notify();
  }

  function focusNext() {
    const next = visibleRecords().sort((a, b) => b.z - a.z)[0];
    if (next) focusWindow(next.win);
    else {
      focused = null;
      if (layer.contains(doc.activeElement)) doc.activeElement.blur();
      syncVisibility();
      notify();
    }
  }

  function stopGesture() {
    if (!gesture) return;
    const active = gesture;
    gesture = null;
    active.controller.abort();
    active.record.win.classList.remove("dragging", "resizing");
    try { active.handle.releasePointerCapture(active.pointerId); } catch { /* The pointer may already be released. */ }
  }

  function startGesture(event, record, resizing) {
    if (event.button !== 0 || isTiled() || record.maximized || (!resizing && event.target.closest("button"))) return;
    event.preventDefault();
    stopGesture();
    focusWindow(record.win, { focusContent: false });
    const handle = event.currentTarget;
    const controller = new AbortController();
    const initial = { ...record.rect }, startX = event.clientX, startY = event.clientY;
    gesture = { record, handle, controller, pointerId: event.pointerId };
    record.win.classList.add(resizing ? "resizing" : "dragging");
    try { handle.setPointerCapture(event.pointerId); } catch { /* Synthetic pointer events have no active pointer. */ }
    doc.addEventListener("pointermove", move => {
      if (move.pointerId !== event.pointerId) return;
      const dx = move.clientX - startX, dy = move.clientY - startY;
      if (resizing) {
        const area = bounds();
        record.rect = clampRect({ ...initial, width: initial.width + dx, height: initial.height + dy });
        // Keep the upper left corner fixed even when the handle reaches the edge.
        record.rect.left = initial.left;
        record.rect.top = initial.top;
        record.rect.width = Math.min(record.rect.width, area.width - initial.left - area.gap);
        record.rect.height = Math.min(record.rect.height, area.height - initial.top - area.gap);
      } else record.rect = clampRect({ ...initial, left: initial.left + dx, top: initial.top + dy });
      setRect(record, record.rect);
    }, { signal: controller.signal });
    const finish = end => { if (end.pointerId === event.pointerId) stopGesture(); };
    doc.addEventListener("pointerup", finish, { signal: controller.signal });
    doc.addEventListener("pointercancel", finish, { signal: controller.signal });
    handle.addEventListener("lostpointercapture", finish, { signal: controller.signal });
  }

  function openApp(id, options = {}) {
    if (destroyed) return null;
    const app = apps[id];
    if (!app) { toast(`Programmet '${id}' finns inte.`); return null; }
    if (app.package && !system?.state?.installed?.includes(app.package)) {
      toast(`Installera ${app.package} i Paket eller med sudo apt install ${app.package}.`);
      return null;
    }
    const win = doc.createElement("article");
    const winId = `window-${++sequence}`;
    win.className = "window";
    win.dataset.id = winId;
    win.dataset.app = id;
    win.dataset.workspace = String(workspace);
    win.tabIndex = -1;
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-labelledby", `${winId}-title`);
    // Geometry constraints live here so tiles and small viewports are not forced past their bounds by CSS.
    Object.assign(win.style, { minWidth: "0", minHeight: "0", resize: "none" });
    win.innerHTML = `<header class="titlebar"><span class="title-icon" aria-hidden="true"></span><strong class="window-title" id="${winId}-title"></strong><div class="window-controls"><button type="button" data-action="min" aria-label="Minimera" title="Minimera">—</button><button type="button" data-action="max" aria-label="Maximera" title="Maximera">□</button><button type="button" data-action="close" class="close" aria-label="Stäng" title="Stäng">×</button></div></header><div class="window-body"></div><div class="resize-handle" data-resize="se" aria-hidden="true"></div>`;
    setAppIcon(win.querySelector(".title-icon"), app);
    win.querySelector(".window-title").textContent = app.name;
    const task = doc.createElement("button");
    task.type = "button";
    task.className = "task-button";
    task.dataset.window = winId;
    task.dataset.workspace = String(workspace);
    task.innerHTML = "<span aria-hidden=\"true\"></span><span></span>";
    setAppIcon(task.firstElementChild, app);
    task.lastElementChild.textContent = app.name;
    task.title = app.name;
    const area = bounds(), offset = ((sequence - 1) % 6) * 22;
    const width = Number(app.width) || 700, height = Number(app.height) || 480;
    const controller = new AbortController();
    const record = {
      win, task, workspace, minimized: false, maximized: false, z: 0, controller, dispose: null,
      lastFocused: null, rect: clampRect({ left: (area.width - width) / 2 + offset, top: (area.height - height) / 2 + offset, width, height }),
      resizeHandle: win.querySelector(".resize-handle"), maxButton: win.querySelector("[data-action=max]")
    };
    records.set(win, record);
    layer.append(win);
    taskbar.append(task);
    const listen = (element, type, callback) => element.addEventListener(type, callback, { signal: controller.signal });
    listen(win, "pointerdown", () => focusWindow(win, { focusContent: false }));
    listen(win, "focusin", event => {
      record.lastFocused = event.target;
      if (focused !== win) focusWindow(win, { focusContent: false });
    });
    listen(task, "click", () => { if (focused === win && !record.minimized) minimizeWindow(win); else focusWindow(win); });
    listen(win.querySelector("[data-action=close]"), "click", () => closeWindow(win));
    listen(win.querySelector("[data-action=min]"), "click", () => minimizeWindow(win));
    listen(record.maxButton, "click", () => toggleMaximize(win));
    listen(win.querySelector(".titlebar"), "pointerdown", event => startGesture(event, record, false));
    listen(win.querySelector(".titlebar"), "dblclick", event => { if (!event.target.closest("button")) toggleMaximize(win); });
    listen(record.resizeHandle, "pointerdown", event => startGesture(event, record, true));
    record.titleObserver = new view.MutationObserver(() => {
      const title = win.querySelector(".window-title").textContent;
      task.lastElementChild.textContent = title;
      task.title = title;
    });
    record.titleObserver.observe(win.querySelector(".window-title"), { childList: true, characterData: true, subtree: true });
    applyLayout();
    try {
      const disposer = app.render(win.querySelector(".window-body"), options, win);
      if (typeof disposer === "function") record.dispose = disposer;
      else if (typeof disposer?.dispose === "function") record.dispose = () => disposer.dispose();
    } catch (error) {
      closeWindow(win);
      toast(`Kunde inte öppna ${app.name}: ${error.message}`);
      return null;
    }
    closeLauncher();
    focusWindow(win);
    return win;
  }

  function closeWindow(win) {
    const record = records.get(win);
    if (!record) return;
    if (gesture?.record === record) stopGesture();
    const wasFocused = focused === win;
    records.delete(win);
    cycle = null;
    record.controller.abort();
    record.titleObserver.disconnect();
    try { record.dispose?.(); } catch (error) { console.error("Kunde inte städa upp programmet", error); }
    win.remove();
    record.task.remove();
    if (wasFocused) focusNext();
    applyLayout();
    notify();
  }

  function minimizeWindow(win) {
    const record = records.get(win);
    if (!record) return;
    if (gesture?.record === record) stopGesture();
    record.minimized = true;
    cycle = null;
    if (focused === win) focusNext();
    applyLayout();
    notify();
  }

  function toggleMaximize(win) {
    const record = records.get(win);
    if (!record) return;
    stopGesture();
    record.maximized = !record.maximized;
    focusWindow(win);
  }

  function switchWorkspace(number, { focus = true } = {}) {
    const target = Number(number);
    if (!Number.isInteger(target) || target < 1 || target > 4 || destroyed) return false;
    if (workspace === target) return true;
    stopGesture();
    cycle = null;
    workspace = target;
    focused = null;
    closeLauncher();
    applyLayout();
    if (focus) focusNext();
    else if (layer.contains(doc.activeElement)) doc.activeElement.blur();
    notify();
    return true;
  }

  function moveWindowToWorkspace(win, number, { follow = true } = {}) {
    const record = records.get(win), target = Number(number);
    if (!record || !Number.isInteger(target) || target < 1 || target > 4) return false;
    stopGesture();
    record.workspace = target;
    win.dataset.workspace = String(target);
    record.task.dataset.workspace = String(target);
    if (follow) focusWindow(win);
    else if (focused === win && target !== workspace) focusNext();
    applyLayout();
    notify();
    return true;
  }

  /** getWindows({ workspace: 2 }) includes minimized windows; no argument returns every workspace. */
  function getWindows(options = {}) {
    return [...records.values()].filter(record => options.workspace === undefined || record.workspace === Number(options.workspace)).map(record => record.win);
  }

  function onKeyDown(event) {
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.getModifierState?.("AltGraph")) return;
    if (event.altKey && !event.ctrlKey && event.key === "Tab") {
      event.preventDefault();
      if (!cycle) cycle = currentRecords().sort((a, b) => b.z - a.z).map(record => record.win);
      if (!cycle.length) return;
      const index = cycle.indexOf(focused), direction = event.shiftKey ? -1 : 1;
      const target = cycle[(index + direction + cycle.length) % cycle.length];
      focusWindow(target, { preserveCycle: true });
      return;
    }
    if (!event.ctrlKey || !event.altKey) return;
    if (event.code === "KeyT" || event.key.toLowerCase() === "t") {
      if (!event.shiftKey) { event.preventDefault(); if (!event.repeat) openApp("terminal"); }
      return;
    }
    let target = /^Digit[1-4]$/.test(event.code) ? Number(event.code.slice(-1)) : /^[1-4]$/.test(event.key) ? Number(event.key) : null;
    if (event.key === "ArrowRight") target = workspace % 4 + 1;
    if (event.key === "ArrowLeft") target = (workspace + 2) % 4 + 1;
    if (target === null) return;
    event.preventDefault();
    if (event.shiftKey && focused) moveWindowToWorkspace(focused, target);
    else switchWorkspace(target);
  }

  if (workspaceBar) {
    if (!workspaceBar.querySelector("[data-workspace]")) {
      for (let index = 1; index <= 4; index++) {
        const button = doc.createElement("button");
        button.type = "button";
        button.dataset.workspace = String(index);
        button.textContent = String(index);
        workspaceBar.append(button);
      }
    }
    workspaceBar.addEventListener("click", event => {
      const button = event.target.closest("[data-workspace]");
      if (button && workspaceBar.contains(button)) switchWorkspace(button.dataset.workspace);
    }, { signal: lifetime.signal });
  }
  doc.addEventListener("keydown", onKeyDown, { signal: lifetime.signal });
  doc.addEventListener("keyup", event => { if (event.key === "Alt") cycle = null; }, { signal: lifetime.signal });
  view.addEventListener("blur", () => { cycle = null; stopGesture(); }, { signal: lifetime.signal });
  view.addEventListener("resize", queueLayout, { signal: lifetime.signal });
  const resizeObserver = typeof view.ResizeObserver === "function" ? new view.ResizeObserver(queueLayout) : null;
  resizeObserver?.observe(layer);
  const desktopObserver = new view.MutationObserver(queueLayout);
  desktopObserver.observe(doc.body, { attributes: true, attributeFilter: ["data-desktop"] });
  applyLayout();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stopGesture();
    lifetime.abort();
    resizeObserver?.disconnect();
    desktopObserver.disconnect();
    if (layoutFrame) view.cancelAnimationFrame(layoutFrame);
    for (const win of getWindows()) closeWindow(win);
  }

  return { openApp, focusWindow, applyLayout, switchWorkspace, moveWindowToWorkspace, getWindows, closeWindow, minimizeWindow, toggleMaximize, getActiveWorkspace: () => workspace, getFocusedWindow: () => focused, destroy };
}
