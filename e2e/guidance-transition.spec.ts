import { expect, test } from '@playwright/test';

test('mobile guidance search jump shows a dark transition cue before the year target', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByLabel('輸入幼兒園關鍵字搜尋中籤率').fill('內湖國小');

  const shell = page.locator('.dashboard-shell');
  const transitionCue = page.locator('[data-guidance-transition="search-to-target"]');
  const yearPrimary = page.locator('#lottery-guidance-year').getByRole('button', {
    name: '下一步',
  });

  await expect(shell).toHaveClass(/is-guidance-active/u);
  await expect(shell).toHaveClass(/is-guidance-transitioning/u);
  await expect(transitionCue).toBeVisible();
  await expect
    .poll(() => transitionCue.evaluate((cue) => getComputedStyle(cue).animationName))
    .toContain('guidance-transition-cue');

  await expect(page.locator('.guidance-scrim[aria-hidden="true"]')).toBeVisible();
  await expect(page.locator('.is-guidance-target.year-nav-row')).toHaveCount(1);
  await expect(page.locator('#lottery-guidance-year.guidance-card--year')).toBeVisible();
  await expect(yearPrimary).toBeFocused();

  await expect(shell).not.toHaveClass(/is-guidance-transitioning/u, { timeout: 3_000 });
  await expect(transitionCue).toHaveCount(0);
  await expect(yearPrimary).toBeFocused();
});
