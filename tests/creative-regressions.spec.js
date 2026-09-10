import { test, expect } from '@playwright/test';

async function launchInstalled(page, id) {
  await page.goto('/');
  await expect(page.locator('.window[data-app="welcome"]')).toBeVisible();
  await page.locator('.window[data-app="welcome"] [data-action="close"]').click();
  await page.evaluate(async name => {
    const { system } = await import('/src/system.js');
    system.install(name);
  }, id);
  await page.locator('#launcher-button').click();
  await page.getByRole('searchbox', { name: 'Sök program', exact: true }).fill(id);
  await page.locator(`#app-grid [data-app="${id}"]`).click();
  return page.locator(`.window[data-app="${id}"]`);
}

test('Markdown keeps inline code literal while formatting surrounding text', async ({ page }) => {
  const markdown = await launchInstalled(page, 'markdown');
  await markdown.getByLabel('Markdown-källtext').fill('**Fetstil** `**bokstavligt**` och `*kod*` samt `<img src=x onerror=alert(1)>`');
  const preview = markdown.getByLabel('Förhandsvisning');
  await expect(preview.locator('strong')).toHaveText('Fetstil');
  await expect(preview.locator('code')).toHaveText(['**bokstavligt**', '*kod*', '<img src=x onerror=alert(1)>']);
  await expect(preview.locator('code strong, code em, img')).toHaveCount(0);
});

test('Mines leaves desktop workspace shortcuts available from the board', async ({ page }) => {
  const mines = await launchInstalled(page, 'mines');
  await mines.locator('.mine-cell').first().focus();
  await page.keyboard.press('Control+Alt+ArrowRight');
  await expect(page.locator('body')).toHaveAttribute('data-workspace', '2');
});

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Mines cells fit without overlapping at ${viewport.width} by ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const mines = await launchInstalled(page, 'mines');
    for (const level of ['9,9,10', '12,12,22', '16,16,40']) {
      await mines.getByRole('combobox', { name: 'Svårighetsgrad' }).selectOption(level);
      const geometry = await mines.locator('.mine-board').evaluate((board, columns) => {
        const bounds = board.getBoundingClientRect();
        const cells = [...board.children].map(cell => cell.getBoundingClientRect());
        return {
          contained: cells.every(cell => cell.left >= bounds.left - .5 && cell.right <= bounds.right + .5 && cell.top >= bounds.top - .5 && cell.bottom <= bounds.bottom + .5),
          separate: cells.every((cell, index) => (index % columns === 0 || cell.left >= cells[index - 1].right + 2.5) && (index < columns || cell.top >= cells[index - columns].bottom + 2.5)),
        };
      }, Number(level.split(',')[1]));
      expect(geometry, `The ${level} board must keep every button inside its own cell`).toEqual({ contained: true, separate: true });
    }
  });
}

test('Snake leaves the launcher shortcut available and preserves its finished-game message', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-09T12:00:00Z') });
  const snake = await launchInstalled(page, 'snake');
  await page.clock.pauseAt(new Date('2026-09-09T12:01:00Z'));
  await snake.locator('canvas').focus();
  await page.keyboard.press('Control+Space');
  await expect(page.locator('#launcher')).toBeVisible();
  await expect(snake.locator('[data-snake-status]')).not.toContainText('Pausad');
  await page.keyboard.press('Escape');
  await snake.getByRole('button', { name: 'Ny omgång', exact: true }).click();
  await page.clock.runFor(1600);
  const status = snake.locator('[data-snake-status]');
  await expect(status).toContainText('Bra spelat!');
  const finished = await status.textContent();
  await snake.locator('canvas').press('Space');
  await expect(status).toHaveText(finished);
});
