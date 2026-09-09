import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "@playwright/test";

// Real browser geometry and focus matter here; a DOM mock cannot verify tiling or pointer capture.
// The routed fixture tests the manager independently of desktop styling and application startup.
const managerSource = await readFile(new URL("../src/window-manager.js", import.meta.url), "utf8");
const fixture = `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box } body { margin: 0 } [hidden] { display: none !important }
  #window-layer { position: absolute; inset: 0 0 52px; pointer-events: none }
  .window { position: absolute; pointer-events: auto; border: 1px solid }
  .titlebar { height: 42px; display: flex; touch-action: none } .window-title { flex: 1 }
  .window-controls { display: flex } .window-controls button { width: 28px }
  .window-body { height: calc(100% - 42px); overflow: auto }
  .resize-handle { position: absolute; bottom: 0; right: 0; width: 18px; height: 18px; touch-action: none }
  #taskbar { position: absolute; bottom: 0; display: flex } #workspaces { position: absolute; bottom: 0; right: 0 }
</style><body data-desktop="plasma"><section id="window-layer"></section><div id="taskbar"></div><div id="workspaces"></div>
<script type="module">
  import { createWindowManager } from '/src/window-manager.js';
  window.cleaned = 0; window.toasts = [];
  const render = body => { body.innerHTML = '<input aria-label="Text"><textarea></textarea>'; return () => window.cleaned++; };
  const apps = {
    terminal: { name: 'Terminal', icon: 'T', width: 700, height: 450, render },
    editor: { name: 'Editor', icon: 'E', width: 600, height: 400, render },
    locked: { name: 'Locked', package: 'locked', render }
  };
  window.wm = createWindowManager({
    layer: document.querySelector('#window-layer'), taskbar: document.querySelector('#taskbar'),
    apps, system: { state: { installed: [] } }, toast: message => toasts.push(message)
  });
</script>`;

test("window manager in a real browser", { timeout: 90000 }, async t => {
  const channel = process.env.FLINUX_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined);
  const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  t.after(() => browser.close());

  async function createFixture(t) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    t.after(async () => { await page.close(); assert.deepEqual(errors, [], "Unexpected browser errors"); });
    await page.route("http://flinux.test/**", route => route.fulfill({
      contentType: route.request().url().endsWith("window-manager.js") ? "text/javascript" : "text/html",
      body: route.request().url().endsWith("window-manager.js") ? managerSource : fixture
    }));
    await page.goto("http://flinux.test/harness");
    await page.waitForFunction(() => window.wm);
    return page;
  }

  await t.test("gates packages and disposes applications exactly once", async t => {
    const page = await createFixture(t);
    assert.equal(await page.evaluate(() => { wm.openApp("locked"); return wm.getWindows().length; }), 0);
    assert.match(await page.evaluate(() => toasts[0]), /sudo apt install locked/);
    await page.evaluate(() => {
      const first = wm.openApp("terminal");
      wm.openApp("editor");
      wm.closeWindow(first);
      wm.closeWindow(first);
    });
    assert.equal(await page.evaluate(() => cleaned), 1);
    await page.evaluate(() => { wm.destroy(); wm.destroy(); });
    assert.equal(await page.evaluate(() => cleaned), 2);
    assert.equal(await page.locator(".window, .task-button").count(), 0);
    await page.keyboard.press("Control+Alt+t");
    assert.equal(await page.locator(".window").count(), 0, "Destroyed managers must remove keyboard handlers");
  });

  await t.test("bounds dragging and resizing, and restores input focus after minimize", async t => {
    const page = await createFixture(t);
    await page.evaluate(() => { window.first = wm.openApp("terminal"); window.second = wm.openApp("editor"); });
    const header = await page.locator("[data-id=window-2] .titlebar").boundingBox();
    await page.mouse.move(header.x + 80, header.y + 20);
    await page.mouse.down();
    await page.mouse.move(-100, -100);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => second.style.left), "8px");
    assert.equal(await page.evaluate(() => second.style.top), "8px");
    const handle = await page.locator("[data-id=window-2] .resize-handle").boundingBox();
    await page.mouse.move(handle.x + 8, handle.y + 8);
    await page.mouse.down();
    await page.mouse.move(1700, 1200);
    await page.mouse.up();
    assert.ok(await page.evaluate(() => second.getBoundingClientRect().right <= 1280 && second.getBoundingClientRect().bottom <= 748));
    await page.evaluate(() => wm.minimizeWindow(second));
    assert.equal(await page.evaluate(() => second.hidden), true);
    assert.equal(await page.evaluate(() => wm.getFocusedWindow() === first && first.contains(document.activeElement)), true);
    assert.equal(await page.locator(".task-button.active").count(), 1);
    await page.locator('[data-window="window-2"]').click();
    assert.equal(await page.evaluate(() => !second.hidden && wm.getFocusedWindow() === second), true);
  });

  await t.test("keeps workspace windows and tasks isolated, including moves", async t => {
    const page = await createFixture(t);
    await page.evaluate(() => { window.first = wm.openApp("terminal"); wm.switchWorkspace(2); });
    assert.equal(await page.locator(".window:visible, .task-button:visible").count(), 0);
    await page.evaluate(() => { window.second = wm.openApp("editor"); wm.moveWindowToWorkspace(second, 1); });
    assert.equal(await page.evaluate(() => wm.getActiveWorkspace()), 1);
    assert.equal(await page.locator(".window:visible").count(), 2);
    assert.equal(await page.locator(".task-button:visible").count(), 2);
    await page.evaluate(() => wm.moveWindowToWorkspace(second, 4, { follow: false }));
    assert.equal(await page.evaluate(() => wm.getActiveWorkspace()), 1);
    assert.equal(await page.evaluate(() => wm.getFocusedWindow() === first), true);
    assert.equal(await page.locator(".task-button:visible").count(), 1);
    await page.locator('[data-workspace="4"]').last().click();
    assert.equal(await page.evaluate(() => wm.getFocusedWindow() === second), true);
    assert.equal(await page.locator('#workspaces [aria-pressed="true"]').textContent(), "4");
  });

  await t.test("tiles without overlap, supports fullscreen and restores floating geometry", async t => {
    const page = await createFixture(t);
    await page.evaluate(() => {
      window.first = wm.openApp("terminal"); window.second = wm.openApp("editor"); wm.openApp("editor");
      window.savedRect = { left: first.style.left, top: first.style.top, width: first.style.width, height: first.style.height };
      document.body.dataset.desktop = "i3"; wm.applyLayout();
    });
    const tiles = await page.evaluate(() => wm.getWindows().map(win => {
      const rect = win.getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
    }));
    for (let index = 0; index < tiles.length; index++) {
      for (let other = index + 1; other < tiles.length; other++) {
        const a = tiles[index], b = tiles[other];
        assert.ok(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y, "Tiles overlap");
      }
    }
    await page.evaluate(() => wm.toggleMaximize(first));
    assert.equal(await page.locator(".window:visible").count(), 1);
    assert.equal(await page.evaluate(() => first.hidden), false);
    await page.evaluate(() => wm.focusWindow(second));
    assert.equal(await page.locator(".window:visible").count(), 3);
    await page.evaluate(() => { document.body.dataset.desktop = "openbox"; wm.applyLayout(); });
    assert.equal(await page.evaluate(() => JSON.stringify({ left: first.style.left, top: first.style.top, width: first.style.width, height: first.style.height }) === JSON.stringify(savedRect)), true);
    await page.setViewportSize({ width: 375, height: 640 });
    await page.waitForFunction(() => wm.getWindows().every(win => win.getBoundingClientRect().right <= 375));
    for (const desktop of ["plasma", "gnome", "xfce", "i3", "openbox"]) {
      await page.evaluate(desktop => { document.body.dataset.desktop = desktop; wm.applyLayout(); }, desktop);
      assert.ok(await page.evaluate(() => wm.getWindows().every(win => {
        const rect = win.getBoundingClientRect(); return rect.x >= 0 && rect.y >= 0 && rect.right <= 375 && rect.bottom <= 588;
      })), `${desktop} windows outside narrow viewport`);
    }
  });

  await t.test("supports workspace and application shortcuts while preserving ordinary typing", async t => {
    const page = await createFixture(t);
    await page.evaluate(() => wm.openApp("terminal"));
    await page.keyboard.press("Control+Alt+2");
    assert.equal(await page.evaluate(() => wm.getActiveWorkspace()), 2);
    await page.keyboard.press("Control+Alt+t");
    assert.equal(await page.locator(".window:visible").count(), 1);
    await page.keyboard.press("Control+Alt+Shift+ArrowLeft");
    assert.equal(await page.evaluate(() => wm.getActiveWorkspace()), 1);
    assert.equal(await page.locator(".window:visible").count(), 2);
    const beforeTab = await page.evaluate(() => wm.getFocusedWindow().dataset.id);
    await page.keyboard.press("Alt+Tab");
    assert.notEqual(await page.evaluate(() => wm.getFocusedWindow().dataset.id), beforeTab);
    await page.keyboard.insertText("Vanlig text åäö");
    assert.equal(await page.evaluate(() => document.activeElement.value), "Vanlig text åäö");
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", {
      code: "Digit4", key: "4", ctrlKey: true, altKey: true, isComposing: true, bubbles: true
    })));
    assert.equal(await page.evaluate(() => wm.getActiveWorkspace()), 1, "IME events must not switch workspace");
  });
});
