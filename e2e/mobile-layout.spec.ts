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
    const collapseWhitespace = (text: string) => {
      let collapsed = '';
      let pendingSpace = false;

      for (const character of text) {
        if (character.trim() === '') {
          pendingSpace = collapsed.length > 0;
          continue;
        }

        if (pendingSpace) {
          collapsed += ' ';
          pendingSpace = false;
        }

        collapsed += character;
      }

      return collapsed;
    };
    const panelRect = panel.getBoundingClientRect();
    return Array.from(panel.querySelectorAll<HTMLElement>('.sequence-chip'))
      .map((chip) => {
        const rect = chip.getBoundingClientRect();
        return {
          text: collapseWhitespace(chip.textContent ?? ''),
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

  const sequenceAlignment = await sequencePanel.evaluate((panel) => {
    const collapseWhitespace = (text: string) => {
      let collapsed = '';
      let pendingSpace = false;

      for (const character of text) {
        if (character.trim() === '') {
          pendingSpace = collapsed.length > 0;
          continue;
        }

        if (pendingSpace) {
          collapsed += ' ';
          pendingSpace = false;
        }

        collapsed += character;
      }

      return collapsed;
    };
    const trimmedTextBounds = (text: string) => {
      let start = 0;
      let end = text.length;

      while (start < end && text.charAt(start).trim() === '') {
        start += 1;
      }

      while (end > start && text.charAt(end - 1).trim() === '') {
        end -= 1;
      }

      return { start, end };
    };
    const textRect = (element: HTMLElement) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return node.textContent?.trim()
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });
      const textNode = walker.nextNode();

      if (!textNode) {
        throw new Error(`Expected text content in ${element.className}`);
      }

      const text = textNode.textContent ?? '';
      const { start, end } = trimmedTextBounds(text);

      if (start < 0 || end <= start) {
        throw new Error(`Expected non-empty text content in ${element.className}`);
      }

      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const rect = range.getBoundingClientRect();
      range.detach();

      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      };
    };
    const maxDelta = (values: readonly number[]) => {
      const [firstValue = 0] = values;
      return Math.max(0, ...values.map((value) => Math.abs(value - firstValue)));
    };
    const measurements = Array.from(panel.querySelectorAll<HTMLElement>('.sequence-chip'))
      .filter((chip) => chip.getBoundingClientRect().width > 0)
      .map((chip) => {
        const action = chip.querySelector<HTMLElement>('.mdc-evolution-chip__action--primary');
        const actionLabel = chip.querySelector<HTMLElement>('.mat-mdc-chip-action-label');
        const label = chip.querySelector<HTMLElement>('.sequence-chip-label');
        const count = chip.querySelector<HTMLElement>('.sequence-chip-count');
        const badge = chip.querySelector<HTMLElement>('.sequence-hit-badge');

        if (!action || !actionLabel || !label || !count) {
          throw new Error('Expected sequence chip internals to be present');
        }

        const actionRect = action.getBoundingClientRect();
        const trailingElementRect = (badge ?? count).getBoundingClientRect();
        const labelTextRect = textRect(label);
        const countTextRect = textRect(count);

        return {
          text: collapseWhitespace(chip.textContent ?? ''),
          isFillThreshold: chip.classList.contains('is-fill-threshold'),
          labelTextStartOffset: labelTextRect.left - actionRect.left,
          labelTextWidth: labelTextRect.width,
          labelTextHeight: labelTextRect.height,
          countTextEndOffset: actionRect.right - countTextRect.right,
          countTextWidth: countTextRect.width,
          trailingElementEndOffset: actionRect.right - trailingElementRect.right,
          actionLabelWidth: actionLabel.getBoundingClientRect().width,
        };
      });
    const normalMeasurements = measurements.filter((measurement) => !measurement.isFillThreshold);

    return {
      measurements,
      hasFillThreshold: measurements.some((measurement) => measurement.isFillThreshold),
      normalChipCount: normalMeasurements.length,
      maxLabelTextStartDelta: maxDelta(
        measurements.map((measurement) => measurement.labelTextStartOffset),
      ),
      maxNormalCountTextEndDelta: maxDelta(
        normalMeasurements.map((measurement) => measurement.countTextEndOffset),
      ),
      maxTrailingElementEndDelta: maxDelta(
        measurements.map((measurement) => measurement.trailingElementEndOffset),
      ),
    };
  });

  expect(sequenceAlignment.measurements.length).toBeGreaterThan(1);
  expect(sequenceAlignment.normalChipCount).toBeGreaterThan(0);
  expect(sequenceAlignment.hasFillThreshold).toBe(true);
  expect(sequenceAlignment.measurements.every((measurement) => measurement.labelTextWidth > 0)).toBe(
    true,
  );
  expect(
    sequenceAlignment.measurements.every((measurement) => measurement.labelTextHeight > 0),
  ).toBe(true);
  expect(
    sequenceAlignment.measurements.every((measurement) => measurement.countTextWidth > 0),
  ).toBe(true);
  expect(sequenceAlignment.maxLabelTextStartDelta).toBeLessThanOrEqual(2);
  expect(sequenceAlignment.maxNormalCountTextEndDelta).toBeLessThanOrEqual(2);
  expect(sequenceAlignment.maxTrailingElementEndDelta).toBeLessThanOrEqual(2);

  const fillThresholdMetrics = await fillThresholdChip.evaluate((chip) => {
    const collapseWhitespace = (text: string) => {
      let collapsed = '';
      let pendingSpace = false;

      for (const character of text) {
        if (character.trim() === '') {
          pendingSpace = collapsed.length > 0;
          continue;
        }

        if (pendingSpace) {
          collapsed += ' ';
          pendingSpace = false;
        }

        collapsed += character;
      }

      return collapsed;
    };
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
      text: collapseWhitespace(chip.textContent ?? ''),
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
  const yearControlsWidth = await yearControls.evaluate(
    (controls) => getComputedStyle(controls).width,
  );
  expect(yearControlsWidth.endsWith('px')).toBe(true);
  expect(Number.parseFloat(yearControlsWidth)).toBeGreaterThan(0);

  await expect(schoolCard.locator('.year-nav-btn__label')).toHaveCount(0);
});
