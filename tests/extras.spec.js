import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(page);
    expect(errors, 'Applications must not produce uncaught browser errors').toEqual([]);
  },
});

const appWindow = (page, id) => page.locator(`.window[data-app="${id}"]:visible`).last();

async function boot(page) {
  await page.goto('/');
  await expect(page.locator('#launcher-button')).toBeVisible();
  const welcome = appWindow(page, 'welcome');
  await expect(welcome).toBeVisible();
  await welcome.locator('[data-action="close"]').click();
}

async function launch(page, id, query = id) {
  await page.locator('#launcher-button').click();
  await page.getByRole('searchbox', { name: 'Sök program', exact: true }).fill(query);
  await page.locator(`#app-grid [data-app="${id}"]`).click();
  const window = appWindow(page, id);
  await expect(window).toBeVisible();
  return window;
}

async function install(page, name) {
  const discover = await launch(page, 'discover');
  await discover.getByRole('searchbox', { name: 'Sök paket', exact: true }).fill(name);
  const card = discover.locator(`.package-card[data-package="${name}"]`);
  await card.locator('[data-install]').click();
  await expect(card.locator('[data-install]')).toHaveText('Ta bort');
  await discover.locator('[data-action="close"]').click();
}

async function command(terminal, text) {
  const input = terminal.locator('.terminal-input');
  await input.fill(text);
  await input.press('Enter');
  await expect(input).toHaveValue('');
}

test('calculator keyboard respects precedence and recovers from division by zero', async ({ page }) => {
  await boot(page);
  await install(page, 'kcalc');
  const calculator = await launch(page, 'calculator', 'kcalc');
  const result = calculator.getByLabel('Resultat');

  await page.keyboard.type('2+3*4');
  await page.keyboard.press('Enter');
  await expect(result).toHaveText('14');

  await page.keyboard.type('(2+3)*4');
  await page.keyboard.press('Enter');
  await expect(result).toHaveText('20');

  await page.keyboard.type('1/0');
  await page.keyboard.press('Enter');
  await expect(result).toHaveText('Kan inte dela med noll');

  await page.keyboard.type('6/2');
  await page.keyboard.press('Enter');
  await expect(result).toHaveText('3');
});

test('Mines first click is safe and a new difficulty starts a fresh board', async ({ page }) => {
  await boot(page);
  await install(page, 'mines');
  const mines = await launch(page, 'mines');
  const cells = mines.locator('.mine-cell');
  const status = mines.locator('[data-mines-status]');

  await expect(cells).toHaveCount(81);
  await cells.nth(40).click();
  await expect(cells.nth(40)).toHaveClass(/open/);
  await expect(cells.nth(40)).toHaveText('');
  await expect(status).not.toContainText('En mina!');
  expect(await mines.locator('.mine-cell.open').count()).toBeGreaterThan(1);

  await mines.getByRole('button', { name: 'Ny omgång', exact: true }).click();
  await expect(mines.locator('.mine-cell.open')).toHaveCount(0);
  await expect(status).toHaveText('10 minor kvar');

  await mines.getByRole('combobox', { name: 'Svårighetsgrad' }).selectOption('16,16,40');
  await expect(cells).toHaveCount(256);
  await expect(mines.locator('.mine-cell.open')).toHaveCount(0);
  await expect(status).toHaveText('40 minor kvar');
  await cells.first().click();
  await expect(cells.first()).toHaveClass(/open/);
  await expect(cells.first()).toHaveText('');
  await expect(status).not.toContainText('En mina!');
});

test('stopwatch pauses, resumes and resets without counting paused time', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-09T12:00:00Z') });
  await boot(page);
  const clock = await launch(page, 'clock');
  await clock.getByRole('button', { name: 'Stoppur', exact: true }).click();
  await page.clock.pauseAt(new Date('2026-09-09T12:01:00Z'));
  const output = clock.locator('.timer-output');
  await expect(output).toHaveText('00:00');

  await clock.getByRole('button', { name: 'Starta', exact: true }).click();
  await page.clock.fastForward(65_000);
  await expect(output).toHaveText('01:05');

  await clock.getByRole('button', { name: 'Pausa', exact: true }).click();
  await page.clock.fastForward(30_000);
  await expect(output).toHaveText('01:05');

  await clock.getByRole('button', { name: 'Fortsätt', exact: true }).click();
  await page.clock.fastForward(5_000);
  await expect(output).toHaveText('01:10');

  await clock.getByRole('button', { name: 'Nollställ', exact: true }).click();
  await expect(output).toHaveText('00:00');
  await expect(clock.getByRole('button', { name: 'Starta', exact: true })).toBeVisible();
  await page.clock.fastForward(5_000);
  await expect(output).toHaveText('00:00');
  await clock.locator('[data-action="close"]').click();
  await page.clock.fastForward(5_000);
  await expect(page.locator('.window[data-app="clock"]')).toHaveCount(0);
});

test('backup export and import restore files, installed packages and appearance', async ({ page }) => {
  await boot(page);
  const terminal = await launch(page, 'terminal');
  await command(terminal, 'echo "Sparat leende med åäö" > Documents/backup-prov.txt');
  await command(terminal, 'sudo apt install cowsay');
  await expect(terminal.locator('.terminal-output')).toContainText('Installerade cowsay');
  await terminal.locator('[data-action="close"]').click();

  const settings = await launch(page, 'settings');
  await settings.getByRole('button', { name: 'Välj bakgrunden Midnatt' }).click();
  const welcome = settings.getByRole('checkbox', { name: 'Visa välkomstfönster', exact: true });
  await welcome.focus();
  await welcome.press('Space');
  await expect(welcome).not.toBeChecked();
  const downloaded = page.waitForEvent('download');
  await settings.locator('[data-backup]').click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/^flinux-\d{4}-\d{2}-\d{2}\.json$/);
  const backupFile = await download.path();
  const backup = JSON.parse(await readFile(backupFile, 'utf8'));
  expect(backup.installed).toContain('cowsay');
  expect(backup.settings.wallpaper).toBe('midnatt');
  expect(backup.filesystem.children.home.children.jarl.children.Documents.children['backup-prov.txt'].content).toBe('Sparat leende med åäö\n');

  await settings.getByRole('button', { name: 'Välj bakgrunden Gryning' }).click();
  await settings.locator('[data-action="close"]').click();
  const modifiedTerminal = await launch(page, 'terminal');
  await command(modifiedTerminal, 'echo "Ändrat efter export" > Documents/backup-prov.txt');
  await command(modifiedTerminal, 'sudo apt remove cowsay');
  await expect(modifiedTerminal.locator('.terminal-output')).toContainText('Tog bort cowsay');
  await modifiedTerminal.locator('[data-action="close"]').click();

  const importSettings = await launch(page, 'settings');
  page.once('dialog', dialog => dialog.accept());
  const reloaded = page.waitForEvent('load');
  await importSettings.locator('[data-backup-file]').setInputFiles(backupFile);
  await reloaded;
  await expect(page.locator('body')).toHaveAttribute('data-wallpaper', 'midnatt');
  await expect(page.locator('.window')).toHaveCount(0);

  const restoredTerminal = await launch(page, 'terminal');
  await command(restoredTerminal, 'cat Documents/backup-prov.txt');
  await expect(restoredTerminal.locator('.terminal-output')).toContainText('Sparat leende med åäö');
  await expect(restoredTerminal.locator('.terminal-output')).not.toContainText('Ändrat efter export');
  await command(restoredTerminal, 'cowsay "Tillbaka i flinux"');
  await expect(restoredTerminal.locator('.terminal-output')).toContainText('(oo)');
});
