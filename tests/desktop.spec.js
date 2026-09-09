import { test as base, expect } from '@playwright/test';

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    await use(page);
    expect(errors, 'The complete app must load and run without browser errors or missing resources').toEqual([]);
  },
});

const appWindow = (page, id) => page.locator(`.window[data-app="${id}"]:visible`).last();

async function boot(page) {
  await page.goto('/');
  await expect(page.locator('#launcher-button')).toBeVisible();
  await expect(appWindow(page, 'welcome')).toBeVisible();
}

async function dismissWelcome(page) {
  const welcome = appWindow(page, 'welcome');
  if (await welcome.count()) await welcome.locator('[data-action="close"]').click();
}

async function launch(page, id, query = id) {
  await page.locator('#launcher-button').click();
  await page.getByRole('searchbox', { name: 'Sök program', exact: true }).fill(query);
  await page.locator(`#app-grid [data-app="${id}"]`).click();
  const window = appWindow(page, id);
  await expect(window).toBeVisible();
  await expect(page.locator('#launcher')).toBeHidden();
  return window;
}

async function command(terminal, text) {
  const input = terminal.locator('.terminal-input');
  await input.fill(text);
  await input.press('Enter');
  await expect(input).toHaveValue('');
}

async function install(page, packageName) {
  const discover = await launch(page, 'discover');
  await discover.getByRole('searchbox', { name: 'Sök paket', exact: true }).fill(packageName);
  const card = discover.locator(`.package-card[data-package="${packageName}"]`);
  await card.locator('[data-install]').click();
  await expect(card.locator('[data-install]')).toHaveText('Ta bort');
  return { discover, card };
}

test('starts a branded desktop with welcome actions and working graphical assets', async ({ page }) => {
  await boot(page);
  await expect(page).toHaveTitle('flinux — Det glada linuxet');
  const welcome = appWindow(page, 'welcome');
  await expect(welcome.getByRole('heading', { level: 1 })).toContainText('Mycket leende.');
  await expect(welcome).toContainText('Det glada linuxet');
  await expect(welcome.locator('[data-open]')).toHaveCount(3);
  await expect(page.locator('#workspaces button')).toHaveCount(4);
  await expect(page.locator('#clock')).toContainText(/\d{2}:\d{2}/);
  expect(await page.locator('.desktop-wordmark img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  const favicon = await page.request.get('/assets/favicon.svg');
  expect(favicon.ok()).toBe(true);
  await welcome.locator('[data-open="terminal"]').click();
  await expect(appWindow(page, 'terminal').locator('.terminal-input')).toBeFocused();
});

test('launcher search and keyboard open a usable terminal', async ({ page }) => {
  await boot(page);
  await dismissWelcome(page);
  await page.keyboard.press('Control+Space');
  await expect(page.getByRole('searchbox', { name: 'Sök program', exact: true })).toBeFocused();
  await page.locator('#app-search').fill('terminal');
  await expect(page.locator('#app-grid .app-tile')).toHaveCount(1);
  await page.locator('#app-grid [data-app="terminal"]').click();
  const terminal = appWindow(page, 'terminal');
  await command(terminal, 'pwd');
  await expect(terminal.locator('.terminal-output')).toContainText('/home/jarl');
  await command(terminal, 'printf "hej\\nflinux\\nhej\\n" | sort | uniq -c');
  await expect(terminal.locator('.terminal-output')).toContainText(/2 hej/);
  await terminal.locator('[data-action="close"]').click();
  await expect(page.locator('#taskbar .task-button')).toHaveCount(0);
});

test('GUI and terminal installations share one package registry', async ({ page }) => {
  await boot(page);
  await dismissWelcome(page);
  const { discover } = await install(page, 'cowsay');
  await discover.locator('[data-action="close"]').click();
  const terminal = await launch(page, 'terminal');
  await command(terminal, 'cowsay "Hej flinux"');
  await expect(terminal.locator('.terminal-output')).toContainText('(oo)');
  await command(terminal, 'sudo apt install kcalc');
  const calculator = await launch(page, 'calculator', 'kcalc');
  for (const key of ['7', '×', '8', '=']) await calculator.locator(`[data-key="${key}"]`).click();
  await expect(calculator.getByLabel('Resultat')).toHaveText('56');
  await calculator.locator('[data-action="close"]').click();
  const packages = await launch(page, 'discover');
  await packages.getByRole('searchbox', { name: 'Sök paket', exact: true }).fill('kcalc');
  await expect(packages.locator('[data-package="kcalc"] [data-install]')).toHaveText('Ta bort');
});

test('all five desktop modes work and appearance persists after reload', async ({ page }) => {
  await boot(page);
  await dismissWelcome(page);
  const settings = await launch(page, 'settings');
  for (const desktop of ['gnome', 'xfce', 'i3', 'plasma', 'openbox']) {
    await settings.locator(`.desktop-choice[data-desktop="${desktop}"]`).click();
    await expect(page.locator('body')).toHaveAttribute('data-desktop', desktop);
    await expect(settings.locator(`.desktop-choice[data-desktop="${desktop}"]`)).toHaveAttribute('aria-pressed', 'true');
  }
  await settings.getByRole('button', { name: 'Välj bakgrunden Midnatt' }).click();
  await settings.getByRole('button', { name: 'Persika', exact: true }).click();
  const welcomeSwitch = settings.getByRole('checkbox', { name: 'Visa välkomstfönster', exact: true });
  await welcomeSwitch.focus();
  await welcomeSwitch.press('Space');
  await expect(welcomeSwitch).not.toBeChecked();
  await expect(page.locator('body')).toHaveAttribute('data-wallpaper', 'midnatt');
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-desktop', 'openbox');
  await expect(page.locator('body')).toHaveAttribute('data-wallpaper', 'midnatt');
  await expect(page.locator('.window')).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toBe('#eeaf96');
  const restored = await launch(page, 'settings');
  await expect(restored.getByRole('checkbox', { name: 'Visa välkomstfönster', exact: true })).not.toBeChecked();
  await expect(restored.locator('[data-wallpaper="midnatt"]')).toHaveAttribute('aria-pressed', 'true');
  await restored.locator('[data-action="close"]').click();
  const terminal = await launch(page, 'terminal');
  await command(terminal, 'sudo apt remove openbox');
  await expect(page.locator('body')).toHaveAttribute('data-desktop', 'plasma');
});

test('files created and edited in the GUI are visible in the terminal and persist', async ({ page }) => {
  await boot(page);
  await dismissWelcome(page);
  const files = await launch(page, 'files');
  await files.locator('[data-place="Documents"]').click();
  page.once('dialog', dialog => dialog.accept('glada-test.txt'));
  await files.locator('[data-new-file]').click();
  const editor = appWindow(page, 'kate');
  await editor.getByRole('textbox', { name: 'Filens innehåll' }).fill('Hej från flinux!\nSparat med åäö.');
  await editor.getByRole('textbox', { name: 'Filens innehåll' }).press('Control+s');
  await expect(editor.locator('[data-save-status]')).toHaveText('Sparad');
  await editor.locator('[data-action="close"]').click();
  await files.locator('[data-action="close"]').click();
  const terminal = await launch(page, 'terminal');
  await command(terminal, 'cat Documents/glada-test.txt');
  await expect(terminal.locator('.terminal-output')).toContainText('Sparat med åäö.');
  await page.reload();
  await expect(appWindow(page, 'welcome')).toBeVisible();
  await dismissWelcome(page);
  const restoredFiles = await launch(page, 'files');
  await restoredFiles.locator('[data-place="Documents"]').click();
  await restoredFiles.getByRole('button', { name: 'glada-test.txt', exact: true }).dblclick();
  await expect(appWindow(page, 'kate').getByRole('textbox', { name: 'Filens innehåll' })).toHaveValue('Hej från flinux!\nSparat med åäö.');
});

test('Paint saves a virtual PNG that opens in the image viewer', async ({ page }) => {
  await boot(page);
  await dismissWelcome(page);
  const { card } = await install(page, 'paint');
  await card.locator('[data-launch]').click();
  const paint = appWindow(page, 'paint');
  const canvas = await paint.getByLabel('Rityta').boundingBox();
  await page.mouse.move(canvas.x + 50, canvas.y + 50);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 180, canvas.y + 110, { steps: 8 });
  await page.mouse.up();
  await paint.getByRole('button', { name: 'Spara i Bilder', exact: true }).click();
  await expect(page.locator('#toast-region')).toContainText('Sparad i Bilder:');
  await paint.locator('[data-action="close"]').click();
  const files = await launch(page, 'files');
  await files.locator('[data-place="Pictures"]').click();
  await files.getByRole('button', { name: /^ritning-.*\.png$/ }).dblclick();
  const images = appWindow(page, 'image-viewer');
  await expect(images).toBeVisible();
  await expect(images.locator('.image-stage img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect.poll(() => images.locator('.image-stage img').evaluate(image => image.complete && image.naturalWidth === 1100)).toBe(true);
  await expect(images.locator('[data-image-name]')).toContainText('.png');
});

test('i3 tiles applications and workspaces keep windows and tasks separate', async ({ page }) => {
  await boot(page);
  await dismissWelcome(page);
  const settings = await launch(page, 'settings');
  await settings.locator('.desktop-choice[data-desktop="i3"]').click();
  await settings.locator('[data-action="close"]').click();
  await launch(page, 'terminal');
  await page.keyboard.press('Control+Alt+t');
  await expect(page.locator('.window:visible')).toHaveCount(2);
  const rects = await page.locator('.window:visible').evaluateAll(windows => windows.map(window => {
    const r = window.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
  }));
  const [a, b] = rects;
  expect(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y).toBe(true);
  await page.locator('#workspaces [data-workspace="2"]').click();
  await expect(page.locator('.window:visible')).toHaveCount(0);
  await expect(page.locator('#taskbar .task-button:visible')).toHaveCount(0);
  await launch(page, 'files');
  await page.keyboard.press('Control+Alt+Shift+1');
  await expect(page.locator('body')).toHaveAttribute('data-workspace', '1');
  await expect(page.locator('.window:visible')).toHaveCount(3);
  const focused = page.locator('.window.focused');
  const windowId = await focused.getAttribute('data-id');
  await focused.locator('[data-action="min"]').click();
  await expect(page.locator('.window:visible')).toHaveCount(2);
  await expect(page.locator('#taskbar .task-button.active')).toHaveCount(1);
  await page.locator(`#taskbar [data-window="${windowId}"]`).click();
  await expect(page.locator('.window:visible')).toHaveCount(3);
});

test('launcher, application windows and settings remain usable at 390 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await dismissWelcome(page);
  const terminal = await launch(page, 'terminal');
  await command(terminal, 'echo "Ett litet glatt skrivbord"');
  await expect(terminal.locator('.terminal-output')).toContainText('Ett litet glatt skrivbord');
  const bounds = await terminal.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await terminal.locator('[data-action="close"]').click();
  const settings = await launch(page, 'settings');
  await settings.getByRole('button', { name: 'Välj bakgrunden Gryning' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-wallpaper', 'gryning');
  await settings.locator('[data-action="close"]').click();
  await page.locator('#launcher-button').click();
  const menu = await page.locator('#launcher').boundingBox();
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(390);
  await expect(page.locator('#app-search')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});


test('Linux Lab stays part of the desktop workflow and accepts GUI solutions', async ({ page }) => {
  await boot(page);
  await dismissWelcome(page);
  const lab = await launch(page, 'lab', 'linux lab');
  await expect(lab).toContainText('Öva i ditt eget system.');
  await lab.locator('.training-item').filter({ hasText: 'Installera program' }).click();
  await expect(lab.locator('[data-task]')).toContainText('Installera cowsay');

  await lab.locator('[data-tool="discover"]').click();
  const discover = appWindow(page, 'discover');
  await discover.getByRole('searchbox', { name: 'Sök paket', exact: true }).fill('cowsay');
  const card = discover.locator('.package-card[data-package="cowsay"]');
  await card.locator('[data-install]').click();
  await expect(card.locator('[data-install]')).toHaveText('Ta bort');
  await discover.locator('[data-action="close"]').click();

  await lab.locator('[data-check]').click();
  await expect(lab.locator('[data-result]')).toContainText('✓ Klart');
});
