import { expect, test } from '@playwright/test';

const GUIDANCE_DISMISSED_STORAGE_KEY = 'picked-again.lottery-dashboard.guidance-dismissed';

test.beforeEach(async ({ page }) => {
  await page.addInitScript((storageKey) => {
    window.localStorage.setItem(storageKey, 'true');
  }, GUIDANCE_DISMISSED_STORAGE_KEY);
});

test('mobile sequence chips stay inside the data card and year controls use the previous full-width style', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByLabel('輸入幼兒園關鍵字搜尋中籤率').fill('內湖國小');

  const schoolCard = page.locator('.school-card').first();
  await expect(schoolCard).toBeVisible();

  const sequencePanel = schoolCard.locator('.sequence-panel').first();
  await expect(sequencePanel).toBeVisible();

  const sequenceChips = sequencePanel.locator('.sequence-chip');
  await expect(sequenceChips.first()).toBeVisible();
  expect(await sequenceChips.count()).toBeGreaterThan(0);

  const overflowingChips = await sequencePanel.evaluate((panel) => {
    const panelRect = panel.getBoundingClientRect();
    return Array.from(panel.querySelectorAll<HTMLElement>('.sequence-chip'))
      .map((chip) => {
        const rect = chip.getBoundingClientRect();
        return {
          text: chip.textContent?.replace(/\s+/g, ' ').trim(),
          left: rect.left,
          right: rect.right,
          panelLeft: panelRect.left,
          panelRight: panelRect.right,
        };
      })
      .filter(
        (chip) => chip.left < panelRect.left - 0.5 || chip.right > panelRect.right + 0.5,
      );
  });

  expect(overflowingChips).toEqual([]);

  const pageOverflow = await page.evaluate(() => {
    const documentElement = document.documentElement;
    return documentElement.scrollWidth - documentElement.clientWidth;
  });
  expect(pageOverflow).toBeLessThanOrEqual(1);

  const gridColumns = await sequencePanel
    .locator('.mdc-evolution-chip-set__chips')
    .evaluate((chips) => getComputedStyle(chips).gridTemplateColumns);
  expect(gridColumns).not.toBe('none');

  const yearControls = schoolCard.locator('.year-nav-controls').first();
  await expect(yearControls).toBeVisible();
  await expect(yearControls).toHaveCSS('justify-content', 'space-between');
  await expect(yearControls).toHaveCSS('width', /.+px/);

  await expect(schoolCard.locator('.year-nav-btn__label')).toHaveCount(0);
});
