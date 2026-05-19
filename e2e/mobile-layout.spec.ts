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

  const fillThresholdChip = sequencePanel.locator('.sequence-chip.is-fill-threshold').first();
  await expect(fillThresholdChip).toBeVisible();
  await expect(fillThresholdChip.locator('.sequence-hit-badge')).toHaveText('收滿點');

  const fillThresholdMetrics = await fillThresholdChip.evaluate((chip) => {
    const label = chip.querySelector<HTMLElement>('.sequence-chip-label');
    const count = chip.querySelector<HTMLElement>('.sequence-chip-count');
    const badge = chip.querySelector<HTMLElement>('.sequence-hit-badge');
    const actionLabel = chip.querySelector<HTMLElement>('.mat-mdc-chip-action-label');

    if (!label || !count || !badge || !actionLabel) {
      throw new Error('Expected fill-threshold chip internals to be present');
    }

    const chipRect = chip.getBoundingClientRect();
    const actionRect = actionLabel.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const countRect = count.getBoundingClientRect();
    const badgeRect = badge.getBoundingClientRect();

    return {
      text: chip.textContent?.replace(/\s+/g, ' ').trim(),
      chipWidth: chipRect.width,
      labelClientWidth: label.clientWidth,
      labelScrollWidth: label.scrollWidth,
      labelWidth: labelRect.width,
      labelHeight: labelRect.height,
      countWidth: countRect.width,
      badgeClientWidth: badge.clientWidth,
      badgeScrollWidth: badge.scrollWidth,
      badgeWidth: badgeRect.width,
      badgeHeight: badgeRect.height,
      badgeWithinAction:
        badgeRect.left >= actionRect.left - 0.5 && badgeRect.right <= actionRect.right + 0.5,
      badgeWithinChip:
        badgeRect.left >= chipRect.left - 0.5 && badgeRect.right <= chipRect.right + 0.5,
      labelWithinChip:
        labelRect.left >= chipRect.left - 0.5 && labelRect.right <= chipRect.right + 0.5,
    };
  });

  expect(fillThresholdMetrics.text).toContain('收滿點');
  expect(fillThresholdMetrics.chipWidth).toBeGreaterThanOrEqual(148);
  expect(fillThresholdMetrics.labelClientWidth).toBeGreaterThan(20);
  expect(fillThresholdMetrics.labelScrollWidth).toBeGreaterThan(20);
  expect(fillThresholdMetrics.labelWidth).toBeGreaterThan(20);
  expect(fillThresholdMetrics.labelHeight).toBeGreaterThan(0);
  expect(fillThresholdMetrics.countWidth).toBeGreaterThan(0);
  expect(fillThresholdMetrics.badgeClientWidth + 1).toBeGreaterThanOrEqual(
    fillThresholdMetrics.badgeScrollWidth,
  );
  expect(fillThresholdMetrics.badgeWidth).toBeGreaterThan(0);
  expect(fillThresholdMetrics.badgeHeight).toBeGreaterThan(0);
  expect(fillThresholdMetrics.badgeWithinAction).toBe(true);
  expect(fillThresholdMetrics.badgeWithinChip).toBe(true);
  expect(fillThresholdMetrics.labelWithinChip).toBe(true);

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
