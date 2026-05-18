import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';

import { LotteryDashboardComponent } from './lottery-dashboard.component';
import type { RawLotteryData, SchoolLotteryRates } from './lottery-data.model';
import { LotteryDataService } from './lottery-data.service';
import { buildSchoolLotteryRates, searchSchoolLotteryRates } from './lottery-data.utils';

const sampleData = {
  臺北市蘭州非營利幼兒園: {
    搜尋關鍵字: ['大同區', '臺北市大同區'],
    '5歲': { 正取: 1, 備取: 3 },
    '4歲': { 正取: 9, 備取: 2 },
    '3歲': { 正取: 24, 備取: 22 },
    '2歲專班': { 正取: 16, 備取: 39 },
  },
} satisfies RawLotteryData;

const sampleSchools = buildSchoolLotteryRates(sampleData);
let cachedStylesText: string | null = null;
const guidanceStorageKey = 'picked-again.lottery-dashboard.guidance-dismissed';

type NodeProcess = typeof globalThis & {
  readonly process?: {
    cwd?: () => string;
  };
};

type NodeFsPromises = {
  readFile(path: string | URL, encoding: string): Promise<string>;
};

async function getStylesScssText(): Promise<string> {
  if (cachedStylesText !== null) {
    return cachedStylesText;
  }

  const nodeProcess = globalThis as NodeProcess;

  if (typeof nodeProcess.process?.cwd !== 'function') {
    throw new Error('process.cwd is required to read styles.scss in this test');
  }

  // @ts-expect-error Node built-in types are intentionally not included in browser app config.
  const { readFile } = (await import('node:fs/promises')) as NodeFsPromises;

  cachedStylesText = await readFile(`${nodeProcess.process.cwd()}/src/styles.scss`, 'utf-8');
  return cachedStylesText;
}

async function extractScssRule(selector: string): Promise<string> {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const stylesText = await getStylesScssText();
  const match = stylesText.match(new RegExp(`[^{}]*${escapedSelector}[^{}]*\\{([^}]*)\\}`, 'u'));

  expect(stylesText.includes(selector)).toBe(true);
  expect(match !== null).toBe(true);

  return match?.[1] ?? '';
}

async function extractExactScssRule(selector: string): Promise<string> {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const stylesText = await getStylesScssText();
  const match = stylesText.match(
    new RegExp(`(?:^|\\})\\s*${escapedSelector}\\s*\\{([^}]*)\\}`, 'u'),
  );

  expect(stylesText.includes(selector)).toBe(true);
  expect(match !== null).toBe(true);

  return match?.[1] ?? '';
}

function createServiceMock(loadSchoolRates: () => Observable<readonly SchoolLotteryRates[]>) {
  return {
    dataUrl: 'assets/data.json',
    loadSchoolRates,
    searchSchoolRates: (schools: readonly SchoolLotteryRates[], keyword: string) =>
      searchSchoolLotteryRates(schools, keyword),
  } satisfies Partial<LotteryDataService>;
}

function buildGuidanceTourSchools(): readonly SchoolLotteryRates[] {
  return buildSchoolLotteryRates({
    臺北市教學測試非營利幼兒園: {
      搜尋關鍵字: ['教學測試'],
      '5歲（114學年）': {
        正取: 12,
        備取: 18,
        公告缺額: 12,
        總登記人數: 30,
        各序位: {
          順序1: 4,
          順序2: 4,
          順序8: 18,
        },
      },
      '4歲（113學年）': {
        正取: 6,
        備取: 6,
        公告缺額: 6,
        總登記人數: 12,
        各序位: {
          順序1: 2,
          順序8: 6,
        },
      },
    },
  } satisfies RawLotteryData);
}

function getTestLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function clearGuidanceStorage(): void {
  getTestLocalStorage()?.removeItem(guidanceStorageKey);
}

function setGuidanceDismissed(): void {
  getTestLocalStorage()?.setItem(guidanceStorageKey, 'true');
}

function readGuidanceDismissed(): string | null {
  return getTestLocalStorage()?.getItem(guidanceStorageKey) ?? null;
}

async function renderDashboard(loadSchoolRates = () => of(sampleSchools)) {
  await TestBed.configureTestingModule({
    imports: [LotteryDashboardComponent],
    providers: [{ provide: LotteryDataService, useValue: createServiceMock(loadSchoolRates) }],
  }).compileComponents();

  const fixture = TestBed.createComponent(LotteryDashboardComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return fixture;
}

async function enterSearch(
  fixture: ComponentFixture<LotteryDashboardComponent>,
  keyword: string,
): Promise<void> {
  const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

  input.value = keyword;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

async function clickGuidancePrimary(
  fixture: ComponentFixture<LotteryDashboardComponent>,
): Promise<void> {
  const host = fixture.nativeElement as HTMLElement;
  const primaryButton = host.querySelector('.guidance-card .guidance-primary') as HTMLButtonElement;

  primaryButton.click();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

async function flushCarouselMeasurements(
  fixture: ComponentFixture<LotteryDashboardComponent>,
): Promise<void> {
  window.dispatchEvent(new Event('resize'));
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }

    setTimeout(resolve, 0);
  });
  fixture.detectChanges();
}

function stubElementHeight(element: HTMLElement, height: number): void {
  Object.defineProperty(element, 'offsetHeight', { configurable: true, value: height });
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: height });
}

function getProgressValue(scope: HTMLElement): string | null {
  return scope.querySelector('mat-progress-bar')?.getAttribute('aria-valuenow') ?? null;
}

function getGeneralDecision(ageCard: HTMLElement): HTMLElement {
  return ageCard.querySelector('.general-decision') as HTMLElement;
}

function getDefinitionValue(scope: HTMLElement, label: string): string | undefined {
  return Array.from(scope.querySelectorAll('dl div')).find(
    (row) => row.querySelector('dt')?.textContent?.trim() === label,
  )?.querySelector('dd')?.textContent?.trim();
}

describe('LotteryDashboardComponent', () => {
  beforeEach(() => clearGuidanceStorage());

  afterEach(() => {
    clearGuidanceStorage();
    TestBed.resetTestingModule();
  });

  it('資料等待時應顯示載入狀態', async () => {
    const pendingSchools = new Subject<readonly SchoolLotteryRates[]>();
    const fixture = await renderDashboard(() => pendingSchools.asObservable());

    expect(fixture.nativeElement.textContent).toContain('載入中籤率資料中');

    pendingSchools.complete();
  });

  it('資料載入後應提示輸入關鍵字', async () => {
    const fixture = await renderDashboard();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('輸入關鍵字，快速查看中籤率');
    expect(text).toContain('1 間幼兒園');
    expect(text).toContain('4 個班齡組別');
  });

  it('應顯示底部資料使用聲明', async () => {
    const fixture = await renderDashboard();
    const footerText = fixture.nativeElement.querySelector('.dashboard-footer')?.textContent as
      | string
      | undefined;

    expect(footerText).toContain('資料使用聲明');
    expect(footerText).toContain(
      '本頁資料並非最終公告，僅供參考；實際招生名額、抽籤結果與相關規範，請以主管機關及各幼兒園官方資訊為準。',
    );
    expect(footerText).toContain('特別感謝');
    expect(footerText).toContain('資料提供：米粒');
  });

  it('應顯示符合幼兒園的中籤率並移除重複的正取／備取明細', async () => {
    const fixture = await renderDashboard();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.value = '蘭州';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const text = host.textContent ?? '';

    expect(text).toContain('臺北市蘭州非營利幼兒園');
    expect(text).toContain('5歲');
    expect(text).toContain('25.0%');
    expect(text).toContain('班齡組別');
    expect(text).not.toContain('正取名額');
    expect(text).not.toContain('備取人數');
    expect(text).not.toContain('正取／備取');
    expect(text).not.toContain('1／3');
    expect(host.querySelector('.metric-grid')).toBeNull();
    expect(host.querySelector('.detail-grid')).toBeNull();
    expect(host.querySelector('.district-chips')?.textContent).toContain('大同區');

    const yearCarousel = host.querySelector('.year-carousel') as HTMLElement;
    const yearContainer = host.querySelector('.year-sections') as HTMLElement;
    const singleYearAriaLabel = yearContainer.getAttribute('aria-label') ?? '';

    expect(yearCarousel.querySelector('.year-nav-btn')).toBeNull();
    expect(yearContainer.getAttribute('aria-describedby')).toBeNull();
    expect(singleYearAriaLabel).toContain('臺北市蘭州非營利幼兒園');
    expect(singleYearAriaLabel).not.toMatch(/左右滑動|水平滑動/u);
  });

  it('應分開顯示優先序位與一般序位登記資訊和中籤率', async () => {
    const announcedCountSchools = buildSchoolLotteryRates({
      臺北市公告資訊測試幼兒園: {
        搜尋關鍵字: ['公告資訊測試'],
        '4歲': {
          正取: 8,
          備取: 12,
          公告缺額: 8,
          總登記人數: 20,
          身份別: {
            優先順序: {
              申請: 4,
            },
            一般生: {
              缺額: 6,
              申請: 12,
              正取: 6,
              備取: 6,
              中籤率: 0.5,
            },
          },
        },
      },
    } satisfies RawLotteryData);
    const fixture = await renderDashboard(() => of(announcedCountSchools));
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.value = '公告資訊測試';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const ageCard = host.querySelector('.age-card') as HTMLElement;
    const ageCardLayout = ageCard.querySelector('.age-card-layout') as HTMLElement;
    const decisionPanel = ageCard.querySelector('.decision-panel') as HTMLElement;
    const decisionContext = decisionPanel.querySelector('.decision-context') as HTMLElement;
    const priorityDecision = decisionPanel.querySelector('.priority-decision') as HTMLElement;
    const generalDecision = decisionPanel.querySelector('.general-decision') as HTMLElement;
    const priorityGrid = priorityDecision.querySelector('.decision-grid') as HTMLElement;
    const generalGrid = generalDecision.querySelector('.decision-grid') as HTMLElement;
    const priorityLabels = Array.from(priorityGrid.querySelectorAll('dt')).map((element) =>
      element.textContent?.trim(),
    );
    const generalLabels = Array.from(generalGrid.querySelectorAll('dt')).map((element) =>
      element.textContent?.trim(),
    );
    const ageCardLayoutRule = await extractScssRule('.age-card-layout');
    const decisionGridRule = await extractScssRule('.decision-grid');
    const generalDecisionRule = await extractExactScssRule('.general-decision');
    const generalDecisionValueRule = await extractExactScssRule(
      '.general-decision .decision-grid div:last-child dd',
    );

    expect(ageCardLayout.firstElementChild).toBe(decisionPanel);
    expect(Array.from(ageCardLayout.children)).toEqual([decisionPanel]);
    expect(ageCardLayout.contains(decisionPanel)).toBe(true);
    expect(ageCardLayoutRule).toMatch(/grid-template-columns:\s*1fr;/u);
    expect(decisionGridRule).toMatch(/grid-template-columns:\s*1fr;/u);
    expect(decisionGridRule).not.toContain('repeat(3');
    expect(generalDecisionRule).toMatch(/border:\s*1px solid var\(--pa-hairline-strong\)/u);
    expect(generalDecisionRule).toMatch(/background:\s*var\(--pa-surface-elevated\)/u);
    expect(generalDecisionRule).toMatch(/padding:\s*12px/u);
    expect(generalDecisionRule).not.toMatch(/box-shadow|pa-accent/u);
    expect(generalDecisionValueRule).toMatch(/font-size:\s*20px/u);
    expect(generalDecisionValueRule).toMatch(/font-weight:\s*800/u);
    expect(decisionContext.textContent).toContain('公告缺額');
    expect(decisionContext.textContent).toContain('8');
    expect(decisionContext.textContent).toContain('總登記人數');
    expect(decisionContext.textContent).toContain('20');
    expect(priorityDecision.textContent).toContain('優先序位');
    expect(priorityLabels).toEqual(['優先序位登記人數', '中籤率']);
    expect(getDefinitionValue(priorityDecision, '優先序位登記人數')).toBe('4');
    expect(getDefinitionValue(priorityDecision, '中籤率')).toBe('50.0%');
    expect(generalDecision.textContent).toContain('一般序位');
    expect(generalDecision.textContent).toContain('預設摘要');
    expect(generalLabels).toEqual(['一般序位缺額', '登記人數', '中籤率']);
    expect(getDefinitionValue(generalDecision, '一般序位缺額')).toBe('6');
    expect(getDefinitionValue(generalDecision, '登記人數')).toBe('12');
    expect(getDefinitionValue(generalDecision, '中籤率')).toBe('50.0%');
    expect(decisionPanel.querySelector('.decision-rate')).toBeNull();
    expect(decisionPanel.querySelector('.identity-rate-grid')).toBeNull();
    expect(decisionPanel.textContent).not.toContain('一般生中籤率');
    expect(decisionPanel.textContent).not.toContain('一般申請');
    expect(decisionPanel.textContent).not.toContain('備取／未中');
    expect(decisionPanel.textContent).not.toContain('備取/未中');
    expect(ageCardLayout.querySelector('.rate-rail')).toBeNull();
    expect(host.querySelector('.decision-rate')).toBeNull();
    expect(host.querySelector('.identity-panel')).toBeNull();
    expect(host.querySelector('.rate-rail')).toBeNull();
    expect(host.querySelector('.identity-rate-grid')).toBeNull();
    expect(host.querySelector('.identity-rate-card')).toBeNull();
    expect(host.querySelector('.priority-rate')).toBeNull();
    expect(host.querySelector('.general-rate')).toBeNull();
    expect(host.querySelector('.rate-row')).toBeNull();
    expect(host.querySelector('.count-grid')).toBeNull();
    expect(host.querySelector('.detail-grid')).toBeNull();
    expect(host.textContent).not.toContain('正取／備取');
    expect(host.textContent).not.toContain('一般申請');
    expect(host.textContent).not.toContain('備取／未中');
    expect(host.textContent).not.toContain('備取/未中');
  });

  it('缺少有效中籤率時應在分割資訊面板顯示無法估算', async () => {
    const unknownRateSchools = buildSchoolLotteryRates({
      臺北市無法估算測試幼兒園: {
        搜尋關鍵字: ['無法估算測試'],
        '4歲': {
          正取: 0,
          備取: 0,
          公告缺額: 0,
          總登記人數: 0,
          身份別: {
            優先順序: {
              申請: 0,
            },
            一般生: {
              缺額: 0,
              申請: 0,
            },
          },
        },
      },
    } satisfies RawLotteryData);
    const fixture = await renderDashboard(() => of(unknownRateSchools));
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.value = '無法估算測試';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const ageCard = host.querySelector('.age-card') as HTMLElement;
    const priorityDecision = ageCard.querySelector('.priority-decision') as HTMLElement;
    const generalDecision = getGeneralDecision(ageCard);

    expect(getDefinitionValue(priorityDecision, '中籤率')).toBe('無法估算');
    expect(getDefinitionValue(generalDecision, '中籤率')).toBe('無法估算');
    expect(host.querySelector('.rate-rail')).toBeNull();
    expect(host.querySelector('.identity-rate-card')).toBeNull();
  });

  it('可用行政區關鍵字搜尋幼兒園', async () => {
    const fixture = await renderDashboard();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.value = '大同區';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('臺北市蘭州非營利幼兒園');
    expect(fixture.nativeElement.querySelector('.district-chips')?.textContent).toContain('大同區');
  });

  it('應依學年度拆開班齡資料並以滿版滑動卡片搭配外層 sticky 標頭呈現', async () => {
    const yearSplitSchools = buildSchoolLotteryRates({
      臺北市測試非營利幼兒園: {
        搜尋關鍵字: ['測試', '大同區'],
        '5歲（114學年）': { 正取: 1, 備取: 3 },
        '4歲（114學年）': { 正取: 3, 備取: 1 },
        '3歲（113學年）': { 正取: 4, 備取: 0 },
      },
    } satisfies RawLotteryData);
    const fixture = await renderDashboard(() => of(yearSplitSchools));
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.value = '測試';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const yearCarousel = host.querySelector('.year-carousel') as HTMLElement;
    const stickyHeader = host.querySelector('.year-section-header-viewport') as HTMLElement;
    const headerTrack = stickyHeader.querySelector('.year-section-header-track') as HTMLElement;
    const yearContainer = host.querySelector('.year-sections') as HTMLElement;
    const yearNavRow = yearCarousel.querySelector('.year-nav-row') as HTMLElement;
    const prevBtn = yearCarousel.querySelector('.year-nav-btn--prev') as HTMLElement;
    const nextBtn = yearCarousel.querySelector('.year-nav-btn--next') as HTMLElement;
    const yearGuidance = yearCarousel.querySelector('.guidance-card--year') as HTMLElement;
    const yearHeaders = Array.from(host.querySelectorAll('.year-section-header')) as HTMLElement[];
    const yearSections = Array.from(host.querySelectorAll('.year-section')) as HTMLElement[];
    const yearKickers = Array.from(host.querySelectorAll('.year-kicker')).map((element) =>
      element.textContent?.trim(),
    );
    const yearLabels = Array.from(host.querySelectorAll('.year-tag')).map((element) =>
      element.textContent?.trim(),
    );
    const yearSummaries = Array.from(host.querySelectorAll('.year-summary')).map((element) =>
      element.textContent?.trim(),
    );
    const contextSchools = Array.from(host.querySelectorAll('.year-context-school')).map(
      (element) => element.textContent?.trim(),
    );

    stubElementHeight(yearSections[0] as HTMLElement, 640);
    stubElementHeight(yearSections[1] as HTMLElement, 280);
    await flushCarouselMeasurements(fixture);

    expect(yearNavRow).toBeTruthy();
    expect(prevBtn).toBeTruthy();
    expect(nextBtn).toBeTruthy();
    expect(prevBtn.getAttribute('aria-label')).toBeTruthy();
    expect(nextBtn.getAttribute('aria-label')).toBeTruthy();
    expect(yearNavRow.contains(yearContainer)).toBe(true);
    expect(stickyHeader.nextElementSibling).toBe(yearNavRow);
    expect(yearGuidance.id).toBe('lottery-guidance-year');
    expect(yearGuidance.textContent).toContain('年度切換：左右滑動或按上一年／下一年。');
    expect(yearContainer.getAttribute('role')).toBe('list');
    expect(yearContainer.getAttribute('tabindex')).toBe('0');
    expect(yearContainer.getAttribute('aria-describedby')).toBe('lottery-guidance-year');
    expect(yearContainer.getAttribute('aria-label')).toContain('可水平滑動查看');
    expect(yearContainer.getAttribute('aria-label')).toContain('臺北市測試非營利幼兒園');
    expect(yearCarousel.contains(stickyHeader)).toBe(true);
    expect(stickyHeader.contains(headerTrack)).toBe(true);
    expect(yearContainer.contains(stickyHeader)).toBe(false);
    expect(yearSections).toHaveLength(2);
    expect(yearContainer.style.height).toBe('640px');
    expect(yearSections.map((section) => section.getAttribute('role'))).toEqual([
      'listitem',
      'listitem',
    ]);
    expect(yearSections.map((section) => section.getAttribute('aria-label'))).toEqual([
      '臺北市測試非營利幼兒園 114學年資料',
      '臺北市測試非營利幼兒園 113學年資料',
    ]);
    expect(yearLabels).toEqual(['114學年', '113學年']);
    expect(yearSummaries).toEqual(['2 個班齡', '1 個班齡']);
    expect(yearKickers).toEqual(['目前查看', '目前查看']);
    expect(contextSchools).toEqual(['臺北市測試非營利幼兒園', '臺北市測試非營利幼兒園']);
    expect(yearHeaders[0]?.classList.contains('is-active-year')).toBe(true);
    expect(yearHeaders[0]?.getAttribute('data-active-year')).toBe('true');
    expect(yearHeaders[1]?.classList.contains('is-active-year')).toBe(false);
    expect(yearHeaders[1]?.getAttribute('data-active-year')).toBeNull();
    expect(yearSections[0]?.classList.contains('is-active-year')).toBe(true);
    expect(yearSections[0]?.getAttribute('data-active-year')).toBe('true');
    expect(yearSections[0]?.getAttribute('aria-hidden')).toBeNull();
    expect(yearSections[0]?.hasAttribute('inert')).toBe(false);
    expect(yearSections[1]?.classList.contains('is-active-year')).toBe(false);
    expect(yearSections[1]?.getAttribute('data-active-year')).toBeNull();
    expect(yearSections[1]?.getAttribute('aria-hidden')).toBe('true');
    expect(yearSections[1]?.hasAttribute('inert')).toBe(true);

    const initialActiveAgeCards = Array.from(
      (yearSections[0] as HTMLElement).querySelectorAll('.age-card'),
    ) as HTMLElement[];

    expect(initialActiveAgeCards).toHaveLength(2);
    expect(initialActiveAgeCards[0]?.textContent).toContain('5歲');
    expect(initialActiveAgeCards[0]?.textContent).toContain('25.0%');
    expect(initialActiveAgeCards[1]?.textContent).toContain('4歲');
    expect(initialActiveAgeCards[1]?.textContent).toContain('75.0%');
    expect(yearSections[0]?.textContent).not.toContain('3歲');

    Object.defineProperty(yearContainer, 'clientWidth', { configurable: true, value: 360 });
    yearContainer.scrollLeft = 360;
    yearContainer.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    await flushCarouselMeasurements(fixture);

    expect(headerTrack.style.transform).toBe('translateX(-100%)');
    expect(yearContainer.style.height).toBe('280px');
    expect(yearHeaders[0]?.classList.contains('is-active-year')).toBe(false);
    expect(yearHeaders[0]?.getAttribute('data-active-year')).toBeNull();
    expect(yearHeaders[1]?.classList.contains('is-active-year')).toBe(true);
    expect(yearHeaders[1]?.getAttribute('data-active-year')).toBe('true');
    expect(yearSections[0]?.classList.contains('is-active-year')).toBe(false);
    expect(yearSections[0]?.getAttribute('aria-hidden')).toBe('true');
    expect(yearSections[0]?.hasAttribute('inert')).toBe(true);
    expect(yearSections[1]?.classList.contains('is-active-year')).toBe(true);
    expect(yearSections[1]?.getAttribute('aria-hidden')).toBeNull();
    expect(yearSections[1]?.hasAttribute('inert')).toBe(false);

    const nextActiveAgeCards = Array.from(
      (yearSections[1] as HTMLElement).querySelectorAll('.age-card'),
    ) as HTMLElement[];

    expect(nextActiveAgeCards).toHaveLength(1);
    expect(nextActiveAgeCards[0]?.textContent).toContain('3歲');
    expect(nextActiveAgeCards[0]?.textContent).toContain('100.0%');
    expect(yearSections[1]?.textContent).not.toContain('5歲');
  });

  it('預設應顯示年度教學，並錨定年度滑動區與換年按鈕', async () => {
    const fixture = await renderDashboard(() => of(buildGuidanceTourSchools()));

    await enterSearch(fixture, '教學測試');

    const host = fixture.nativeElement as HTMLElement;
    const yearGuidance = host.querySelector('.guidance-card--year') as HTMLElement;
    const yearContainer = host.querySelector('.year-sections') as HTMLElement;
    const prevBtn = host.querySelector('.year-nav-btn--prev') as HTMLElement;
    const nextBtn = host.querySelector('.year-nav-btn--next') as HTMLElement;

    expect(yearGuidance).toBeTruthy();
    expect(yearGuidance.id).toBe('lottery-guidance-year');
    expect(yearGuidance.getAttribute('role')).toBe('note');
    expect(yearGuidance.textContent).toContain('年度切換：左右滑動或按上一年／下一年。');
    expect(yearGuidance.textContent).toContain('跳過');
    expect(yearGuidance.textContent).toContain('下一步');
    expect(yearContainer.getAttribute('aria-describedby')).toBe('lottery-guidance-year');
    expect(prevBtn.getAttribute('aria-describedby')).toBe('lottery-guidance-year');
    expect(nextBtn.getAttribute('aria-describedby')).toBe('lottery-guidance-year');
  });

  it('教學可跳過並持久化，不會再次自動顯示', async () => {
    const fixture = await renderDashboard(() => of(buildGuidanceTourSchools()));

    await enterSearch(fixture, '教學測試');

    const host = fixture.nativeElement as HTMLElement;
    const skipButton = host.querySelector('.guidance-card .guidance-action') as HTMLButtonElement;

    skipButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector('.guidance-card')).toBeNull();
    expect(readGuidanceDismissed()).toBe('true');

    fixture.destroy();
    TestBed.resetTestingModule();

    const nextFixture = await renderDashboard(() => of(buildGuidanceTourSchools()));

    await enterSearch(nextFixture, '教學測試');

    const nextHost = nextFixture.nativeElement as HTMLElement;

    expect(nextHost.querySelector('.guidance-card')).toBeNull();
    expect(nextHost.querySelector('.year-sections')?.getAttribute('aria-describedby')).toBeNull();
  });

  it('教學可依序前進到序位與一般序位，完成後持久化', async () => {
    const fixture = await renderDashboard(() => of(buildGuidanceTourSchools()));

    await enterSearch(fixture, '教學測試');

    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.guidance-card--year')).toBeTruthy();

    await clickGuidancePrimary(fixture);

    const sequenceGuidance = host.querySelector('.guidance-card--sequence') as HTMLElement;
    const sequencePanel = host.querySelector('.sequence-panel') as HTMLElement;
    const sequenceListbox = host.querySelector('mat-chip-listbox.sequence-list') as HTMLElement;

    expect(sequenceGuidance).toBeTruthy();
    expect(sequenceGuidance.id).toBe('lottery-guidance-sequence');
    expect(sequenceGuidance.textContent).toContain(
      '各序位：點順序查看該序位估算中籤率，可再點或按 × 取消。',
    );
    expect(sequenceGuidance.textContent).toContain('跳過');
    expect(sequenceGuidance.textContent).toContain('下一步');
    expect(sequencePanel.getAttribute('aria-describedby')).toBe('lottery-guidance-sequence');
    expect(sequenceListbox.getAttribute('aria-describedby')).toBe('lottery-guidance-sequence');

    await clickGuidancePrimary(fixture);

    const generalGuidance = host.querySelector('.guidance-card--general') as HTMLElement;
    const generalDecision = host.querySelector('.general-decision') as HTMLElement;
    const finishButton = generalGuidance.querySelector('.guidance-primary') as HTMLButtonElement;

    expect(generalGuidance).toBeTruthy();
    expect(generalGuidance.id).toBe('lottery-guidance-general');
    expect(generalGuidance.textContent).toContain('一般序位：預設摘要，和序位試算分開對照。');
    expect(generalGuidance.textContent).toContain('跳過');
    expect(finishButton.textContent).toContain('完成');
    expect(generalDecision.getAttribute('aria-describedby')).toBe('lottery-guidance-general');

    await clickGuidancePrimary(fixture);

    expect(host.querySelector('.guidance-card')).toBeNull();
    expect(readGuidanceDismissed()).toBe('true');
  });

  it('已跳過時可用教學按鈕重新播放', async () => {
    setGuidanceDismissed();

    const fixture = await renderDashboard(() => of(buildGuidanceTourSchools()));

    await enterSearch(fixture, '教學測試');

    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.guidance-card')).toBeNull();
    expect(readGuidanceDismissed()).toBe('true');

    const replayButton = host.querySelector('.guidance-replay-button') as HTMLButtonElement;

    replayButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const yearGuidance = host.querySelector('.guidance-card--year') as HTMLElement;

    expect(yearGuidance).toBeTruthy();
    expect(yearGuidance.textContent).toContain('年度切換：左右滑動或按上一年／下一年。');
    expect(readGuidanceDismissed()).toBeNull();
  });

  it('公告缺額在特定順序達標時應高亮該順序', async () => {
    const sequenceHighlightSchools = buildSchoolLotteryRates({
      臺北市順序高亮測試幼兒園: {
        搜尋關鍵字: ['高亮測試'],
        '4歲': {
          正取: 40,
          備取: 5,
          公告缺額: 40,
          各序位: {
            順序1: 4,
            順序2: 5,
            順序3: 6,
            順序4: 5,
            順序5: 7,
            順序6: 4,
            順序7: 9,
            順序8: 3,
          },
        },
      },
    } satisfies RawLotteryData);
    const fixture = await renderDashboard(() => of(sequenceHighlightSchools));
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.value = '高亮測試';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const ageCard = host.querySelector('.age-card') as HTMLElement;
    const ageCardLayout = ageCard.querySelector('.age-card-layout') as HTMLElement;
    const decisionPanel = ageCard.querySelector('.decision-panel') as HTMLElement;
    const sequencePanel = host.querySelector('.sequence-panel') as HTMLElement;
    const highlightedChip = host.querySelector(
      'mat-chip-option.sequence-chip.is-fill-threshold',
    ) as HTMLElement;
    const highlightedOption = highlightedChip.querySelector('[role="option"]') as HTMLElement;

    expect(ageCard.querySelector('.rate-rail')).toBeNull();
    expect(ageCard.querySelector('.identity-rate-card mat-progress-bar')).toBeNull();
    expect(ageCard.querySelector('.decision-panel .decision-rate')).toBeNull();
    expect(ageCardLayout.contains(sequencePanel)).toBe(false);
    expect(decisionPanel.contains(sequencePanel)).toBe(false);
    expect(sequencePanel.parentElement).toBe(ageCardLayout.parentElement);
    expect(sequencePanel.nextElementSibling).toBe(ageCardLayout);
    expect(highlightedChip.textContent).toContain('順序7');
    expect(highlightedChip.textContent).toContain('收滿點');
    expect(host.querySelector('.sequence-fulfillment-hint')?.textContent).toContain(
      '在順序7已達收滿門檻',
    );

    highlightedOption.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const selectedFillThresholdChip = host.querySelector(
      'mat-chip-option.sequence-chip.is-fill-threshold.is-selected',
    ) as HTMLElement;
    const selectedFillThresholdOption = selectedFillThresholdChip.querySelector(
      '[role="option"]',
    ) as HTMLElement | null;

    expect(selectedFillThresholdChip).toBeTruthy();
    expect(selectedFillThresholdOption?.getAttribute('aria-selected')).toBe('true');
    expect(selectedFillThresholdChip.querySelector('.sequence-hit-badge')?.textContent).toContain(
      '收滿點',
    );
    const selectedSequenceRate = sequencePanel.querySelector(
      '.selected-sequence-rate',
    ) as HTMLElement;
    expect(selectedSequenceRate?.textContent).toContain('選取序位中籤率');
    expect(ageCardLayout.querySelector('.selected-sequence-rate')).toBeNull();
    expect(sequencePanel.contains(selectedSequenceRate)).toBe(true);
  });

  it('序位選項應以可點選 listbox 呈現，且再次點選已選序位會取消選取', async () => {
    const publicSequenceSchools = buildSchoolLotteryRates({
      臺北市公立序位測試幼兒園: {
        搜尋關鍵字: ['公立序位'],
        '4歲': {
          正取: 10,
          備取: 20,
          公告缺額: 10,
          一般順序: 20,
          一般順序中籤率: 0.5,
          各序位: {
            順序1: 4,
            順序2: 4,
            順序8: 20,
          },
        },
      },
    } satisfies RawLotteryData);
    const fixture = await renderDashboard(() => of(publicSequenceSchools));
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.value = '公立序位';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const listbox = host.querySelector('mat-chip-listbox.sequence-list') as HTMLElement;
    const sequenceEightChip = Array.from(
      host.querySelectorAll('mat-chip-option.sequence-chip'),
    ).find((chip) => chip.textContent?.includes('順序8')) as HTMLElement;
    const sequenceEightOption = sequenceEightChip.querySelector('[role="option"]') as HTMLElement;
    const ageCard = host.querySelector('.age-card') as HTMLElement;
    const sequencePanel = ageCard.querySelector('.sequence-panel') as HTMLElement;
    const generalDecision = getGeneralDecision(ageCard);

    expect(listbox.getAttribute('role')).toBe('listbox');
    expect(listbox.getAttribute('aria-label')).toContain('選擇後顯示選取序位中籤率');
    expect(host.querySelector('mat-chip-option.sequence-chip.is-selected')).toBeNull();
    expect(
      host.querySelector('mat-chip-option.sequence-chip [role="option"][aria-selected="true"]'),
    ).toBeNull();
    expect(sequenceEightOption.getAttribute('aria-label')).not.toContain('目前選取');
    expect(sequenceEightOption.getAttribute('aria-label')).toContain('選擇後顯示選取序位中籤率');
    expect(host.querySelector('.decision-panel .decision-rate')).toBeNull();
    expect(generalDecision.textContent).toContain('一般序位');
    expect(getDefinitionValue(generalDecision, '中籤率')).toBe('50.0%');
    expect(ageCard.querySelector('.rate-rail')).toBeNull();
    expect(ageCard.querySelector('.age-card-layout .selected-sequence-rate')).toBeNull();
    expect(sequencePanel.querySelector('.selected-sequence-rate')).toBeNull();

    sequenceEightOption.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const selectedChip = host.querySelector(
      'mat-chip-option.sequence-chip.is-selected',
    ) as HTMLElement;
    const selectedOption = selectedChip.querySelector('[role="option"]') as HTMLElement;

    expect(selectedChip.textContent).toContain('順序8');
    expect(selectedOption.getAttribute('aria-selected')).toBe('true');
    expect(selectedOption.getAttribute('aria-label')).toContain('目前選取');
    expect(getDefinitionValue(generalDecision, '中籤率')).toBe('50.0%');

    const selectedSequenceRate = sequencePanel.querySelector(
      '.selected-sequence-rate',
    ) as HTMLElement;
    const selectedSequenceRateRule = await extractExactScssRule('.selected-sequence-rate');
    const stylesText = await getStylesScssText();

    expect(selectedSequenceRate.getAttribute('aria-live')).toBe('polite');
    expect(selectedSequenceRate.textContent).toContain('選取序位中籤率');
    expect(selectedSequenceRate.textContent).toContain('順序8');
    expect(selectedSequenceRate.textContent).toContain('10.0%');
    expect(getProgressValue(selectedSequenceRate)).toBe('10');
    expect(ageCard.querySelector('.age-card-layout .selected-sequence-rate')).toBeNull();
    expect(sequencePanel.contains(selectedSequenceRate)).toBe(true);
    expect(selectedSequenceRateRule).toMatch(
      /animation:\s*selected-sequence-rate-reveal\s+\d+ms\s+cubic-bezier\([^)]*\)\s+both;/u,
    );
    expect(stylesText).toMatch(/@keyframes\s+selected-sequence-rate-reveal/u);
    expect(stylesText).toMatch(
      /@keyframes\s+selected-sequence-rate-reveal\s*\{[\s\S]*opacity:\s*0;[\s\S]*transform:\s*translateY\(-6px\)\s+scale\(0\.985\);[\s\S]*border-color:[\s\S]*background-color:/u,
    );
    expect(stylesText).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.selected-sequence-rate\s*\{[\s\S]*animation:\s*none;[\s\S]*transform:\s*none;/u,
    );

    // Cancel button assertions
    const cancelBtn = selectedSequenceRate.querySelector('.sequence-cancel-btn') as HTMLElement;

    expect(cancelBtn).toBeTruthy();
    expect(cancelBtn.getAttribute('type')).toBe('button');
    expect(cancelBtn.getAttribute('aria-label')).toContain('取消');
    expect(cancelBtn.getAttribute('aria-label')).toContain('順序8');

    // Touch pointerdown should cancel selection and preventDefault
    const touchPointerEvent = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
    });

    cancelBtn.dispatchEvent(touchPointerEvent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(touchPointerEvent.defaultPrevented).toBe(true);
    expect(host.querySelector('mat-chip-option.sequence-chip.is-selected')).toBeNull();
    expect(
      host.querySelector('mat-chip-option.sequence-chip [role="option"][aria-selected="true"]'),
    ).toBeNull();
    expect(sequencePanel.querySelector('.selected-sequence-rate')).toBeNull();
  });

  it('序位取消按鈕在滑鼠 click 也能清除選取', async () => {
    const publicSequenceSchools = buildSchoolLotteryRates({
      臺北市公立序位測試幼兒園: {
        搜尋關鍵字: ['公立序位'],
        '4歲': {
          正取: 10,
          備取: 20,
          公告缺額: 10,
          一般順序: 20,
          一般順序中籤率: 0.5,
          各序位: { 順序1: 4, 順序2: 4, 順序8: 20 },
        },
      },
    } satisfies RawLotteryData);
    const fixture = await renderDashboard(() => of(publicSequenceSchools));
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.value = '公立序位';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const sequenceEightOption = (
      Array.from(host.querySelectorAll('mat-chip-option.sequence-chip')).find((chip) =>
        chip.textContent?.includes('順序8'),
      ) as HTMLElement
    ).querySelector('[role="option"]') as HTMLElement;
    const sequencePanel = host.querySelector('.sequence-panel') as HTMLElement;

    sequenceEightOption.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const selectedSequenceRate = sequencePanel.querySelector(
      '.selected-sequence-rate',
    ) as HTMLElement;

    expect(selectedSequenceRate).toBeTruthy();

    const cancelBtn = selectedSequenceRate.querySelector('.sequence-cancel-btn') as HTMLElement;

    cancelBtn.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector('mat-chip-option.sequence-chip.is-selected')).toBeNull();
    expect(sequencePanel.querySelector('.selected-sequence-rate')).toBeNull();
  });

  it('序位選項 SCSS 中取消按鈕樣式存在且符合 DESIGN.md', async () => {
    const stylesText = await getStylesScssText();

    expect(stylesText).toMatch(/\.sequence-cancel-btn\s*\{/u);
    expect(stylesText).toMatch(/\.sequence-cancel-btn\s*\{[^}]*border:/u);
    expect(stylesText).toMatch(/\.sequence-cancel-btn\s*\{[^}]*cursor:\s*pointer/u);
    expect(stylesText).toMatch(/\.sequence-cancel-btn:focus-visible\s*\{[^}]*outline:/u);
  });

  it('左右換年按鈕符合 DESIGN.md 深色按鍵設計且可操作', async () => {
    const yearSplitSchools = buildSchoolLotteryRates({
      臺北市測試非營利幼兒園: {
        搜尋關鍵字: ['測試', '大同區'],
        '5歲（114學年）': { 正取: 1, 備取: 3 },
        '4歲（114學年）': { 正取: 3, 備取: 1 },
        '3歲（113學年）': { 正取: 4, 備取: 0 },
      },
    } satisfies RawLotteryData);
    const fixture = await renderDashboard(() => of(yearSplitSchools));
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.value = '測試';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const yearContainer = host.querySelector('.year-sections') as HTMLElement;
    const prevBtn = host.querySelector('.year-nav-btn--prev') as HTMLButtonElement;
    const nextBtn = host.querySelector('.year-nav-btn--next') as HTMLButtonElement;

    expect(prevBtn.tagName).toBe('BUTTON');
    expect(nextBtn.tagName).toBe('BUTTON');
    expect(prevBtn.getAttribute('aria-label')).toBe('查看上一學年度');
    expect(nextBtn.getAttribute('aria-label')).toBe('查看下一學年度');
    expect(prevBtn.disabled).toBe(true);
    expect(nextBtn.disabled).toBe(false);
    expect(prevBtn.textContent).toContain('上一年');
    expect(nextBtn.textContent).toContain('下一年');

    Object.defineProperty(yearContainer, 'clientWidth', { configurable: true, value: 360 });

    let scrollToCallArgs: Parameters<typeof yearContainer.scrollTo> | null = null;

    Object.defineProperty(yearContainer, 'scrollTo', {
      configurable: true,
      writable: true,
      value: (...args: Parameters<typeof yearContainer.scrollTo>) => {
        scrollToCallArgs = args;
      },
    });

    nextBtn.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(scrollToCallArgs).not.toBeNull();
    expect(scrollToCallArgs?.[0]).toEqual({ left: 360, behavior: 'smooth' });

    yearContainer.scrollLeft = 360;
    yearContainer.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    await flushCarouselMeasurements(fixture);

    const nextYearHeaders = Array.from(
      host.querySelectorAll('.year-section-header'),
    ) as HTMLElement[];

    expect(nextYearHeaders[0]?.classList.contains('is-active-year')).toBe(false);
    expect(nextYearHeaders[1]?.classList.contains('is-active-year')).toBe(true);
    expect(nextBtn.disabled).toBe(true);
    expect(prevBtn.disabled).toBe(false);

    const navBtnRule = await extractExactScssRule('.year-nav-btn');
    const stylesText = await getStylesScssText();

    expect(navBtnRule).toMatch(/min-height:\s*44px/u);
    expect(navBtnRule).toMatch(/border:/u);
    expect(navBtnRule).toMatch(/pa-hairline-strong/u);
    expect(navBtnRule).toMatch(/border-radius:\s*var\(--pa-radius-md\)/u);
    expect(navBtnRule).toMatch(/background:\s*var\(--pa-surface-elevated\)/u);
    expect(navBtnRule).not.toMatch(/box-shadow/u);
    expect(navBtnRule).not.toMatch(/opacity/u);
    expect(stylesText).toMatch(/\.year-nav-btn:focus-visible\s*\{[^}]*outline:/u);
    expect(stylesText).toMatch(/\.year-nav-btn\[disabled\]\s*\{[^}]*opacity:/u);
    expect(stylesText).not.toMatch(/\.year-nav-btn\[disabled\][^{]*\{[^}]*opacity:\s*0\.3/u);
    expect(stylesText).toMatch(
      /@media\s*\(width\s*<=\s*640px\)[\s\S]*\.year-nav-btn__label\s*\{[^}]*display:\s*none/u,
    );
  });

  it('序位選取取消後再次點選相同序位可重新選取', async () => {
    const refixPublicSchools = buildSchoolLotteryRates({
      臺北市公立序位測試幼兒園: {
        搜尋關鍵字: ['公立序位'],
        '4歲': {
          正取: 10,
          備取: 20,
          公告缺額: 10,
          一般順序: 20,
          一般順序中籤率: 0.5,
          各序位: { 順序1: 4, 順序2: 4, 順序8: 20 },
        },
      },
    } satisfies RawLotteryData);
    const fixture = await renderDashboard(() => of(refixPublicSchools));
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.value = '公立序位';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const sequenceEightOption = (
      Array.from(host.querySelectorAll('mat-chip-option.sequence-chip')).find((chip) =>
        chip.textContent?.includes('順序8'),
      ) as HTMLElement
    ).querySelector('[role="option"]') as HTMLElement;
    const sequencePanel = host.querySelector('.sequence-panel') as HTMLElement;

    sequenceEightOption.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const cancelBtn = sequencePanel.querySelector('.sequence-cancel-btn') as HTMLElement;

    cancelBtn.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(sequencePanel.querySelector('.selected-sequence-rate')).toBeNull();

    sequenceEightOption.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(sequencePanel.querySelector('.selected-sequence-rate')).toBeTruthy();
    expect(sequencePanel.querySelector('.selected-sequence-rate')?.textContent).toContain('順序8');
  });

  it('listbox (change) 再次點選已選序位仍能取消選取（桌機路徑）', async () => {
    const toggleSchools = buildSchoolLotteryRates({
      臺北市公立序位測試幼兒園: {
        搜尋關鍵字: ['公立序位'],
        '4歲': {
          正取: 10,
          備取: 20,
          公告缺額: 10,
          一般順序: 20,
          一般順序中籤率: 0.5,
          各序位: { 順序1: 4, 順序2: 4, 順序8: 20 },
        },
      },
    } satisfies RawLotteryData);
    const fixture = await renderDashboard(() => of(toggleSchools));
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.value = '公立序位';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const sequenceEightOption = (
      Array.from(host.querySelectorAll('mat-chip-option.sequence-chip')).find((chip) =>
        chip.textContent?.includes('順序8'),
      ) as HTMLElement
    ).querySelector('[role="option"]') as HTMLElement;
    const sequencePanel = host.querySelector('.sequence-panel') as HTMLElement;

    sequenceEightOption.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(sequencePanel.querySelector('.selected-sequence-rate')).toBeTruthy();

    sequenceEightOption.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector('mat-chip-option.sequence-chip.is-selected')).toBeNull();
    expect(sequencePanel.querySelector('.selected-sequence-rate')).toBeNull();
  });

  it('手機版 SCSS 中 age-card-layout 和 sequence-panel 的排列順序', async () => {
    const stylesText = await getStylesScssText();
    expect(stylesText).toMatch(
      /@media\s*\(width\s*<=\s*640px\)[\s\S]*\.age-card\s+mat-card-content\s*>\s*\.age-card-layout\s*\{[^}]*order\s*:\s*1/u,
    );
    expect(stylesText).toMatch(
      /@media\s*\(width\s*<=\s*640px\)[\s\S]*\.age-card\s+mat-card-content\s*>\s*\.sequence-panel\s*\{[^}]*order\s*:\s*2/u,
    );
  });

  it('非營利資料點選順序9後才以一般生序位重新計算', async () => {
    const nonprofitSequenceSchools = buildSchoolLotteryRates({
      臺北市非營利序位測試幼兒園: {
        搜尋關鍵字: ['非營利序位'],
        '4歲': {
          正取: 10,
          備取: 20,
          公告缺額: 10,
          一般順序: 20,
          一般順序中籤率: 0.5,
          各序位: {
            順序1: 3,
            順序8: 4,
            順序9: 20,
          },
        },
      },
    } satisfies RawLotteryData);
    const fixture = await renderDashboard(() => of(nonprofitSequenceSchools));
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.value = '非營利序位';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const sequenceNineChip = Array.from(
      host.querySelectorAll('mat-chip-option.sequence-chip'),
    ).find((chip) => chip.textContent?.includes('順序9')) as HTMLElement;
    const sequenceNineOption = sequenceNineChip.querySelector('[role="option"]') as HTMLElement;
    const ageCard = host.querySelector('.age-card') as HTMLElement;
    const sequencePanel = ageCard.querySelector('.sequence-panel') as HTMLElement;
    const generalDecision = getGeneralDecision(ageCard);

    expect(host.querySelector('mat-chip-option.sequence-chip.is-selected')).toBeNull();
    expect(sequenceNineOption.getAttribute('aria-selected')).not.toBe('true');
    expect(sequenceNineOption.getAttribute('aria-label')).not.toContain('目前選取');
    expect(host.querySelector('.decision-panel .decision-rate')).toBeNull();
    expect(generalDecision.textContent).toContain('一般序位');
    expect(getDefinitionValue(generalDecision, '中籤率')).toBe('50.0%');
    expect(ageCard.querySelector('.rate-rail')).toBeNull();
    expect(ageCard.querySelector('.age-card-layout .selected-sequence-rate')).toBeNull();

    sequenceNineOption.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const selectedChip = host.querySelector(
      'mat-chip-option.sequence-chip.is-selected',
    ) as HTMLElement;
    const selectedOption = selectedChip.querySelector('[role="option"]') as HTMLElement;

    expect(selectedChip.textContent).toContain('順序9');
    expect(selectedOption.getAttribute('aria-selected')).toBe('true');
    expect(selectedOption.getAttribute('aria-label')).toContain('目前選取');
    expect(getDefinitionValue(generalDecision, '中籤率')).toBe('50.0%');

    const selectedSequenceRate = sequencePanel.querySelector(
      '.selected-sequence-rate',
    ) as HTMLElement;

    expect(selectedSequenceRate.textContent).toContain('選取序位中籤率');
    expect(selectedSequenceRate.textContent).toContain('順序9');
    expect(selectedSequenceRate.textContent).toContain('15.0%');
    expect(getProgressValue(selectedSequenceRate)).toBe('15');
    expect(ageCard.querySelector('.age-card-layout .selected-sequence-rate')).toBeNull();
    expect(sequencePanel.contains(selectedSequenceRate)).toBe(true);
  });

  it('點選序位應只更新該班齡的中籤率、進度與選取狀態', async () => {
    const selectableSequenceSchools = buildSchoolLotteryRates({
      臺北市點選序位測試幼兒園: {
        搜尋關鍵字: ['點選序位'],
        '4歲': {
          正取: 10,
          備取: 20,
          公告缺額: 10,
          各序位: {
            順序1: 4,
            順序2: 4,
            順序8: 20,
          },
        },
        '3歲': {
          正取: 8,
          備取: 10,
          公告缺額: 8,
          各序位: {
            順序1: 2,
            順序2: 2,
            順序8: 10,
          },
        },
      },
    } satisfies RawLotteryData);
    const fixture = await renderDashboard(() => of(selectableSequenceSchools));
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.value = '點選序位';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const ageCards = Array.from(host.querySelectorAll('.age-card')) as HTMLElement[];
    const firstAgeCard = ageCards[0] as HTMLElement;
    const secondAgeCard = ageCards[1] as HTMLElement;
    const sequenceTwoChip = Array.from(
      firstAgeCard.querySelectorAll('mat-chip-option.sequence-chip'),
    ).find((chip) => chip.textContent?.includes('順序2')) as HTMLElement;
    const sequenceTwoOption = sequenceTwoChip.querySelector('[role="option"]') as HTMLElement;

    const firstGeneralDecision = getGeneralDecision(firstAgeCard);
    const secondGeneralDecision = getGeneralDecision(secondAgeCard);

    expect(getDefinitionValue(firstGeneralDecision, '中籤率')).toBe('33.3%');
    expect(getDefinitionValue(secondGeneralDecision, '中籤率')).toBe('44.4%');
    expect(firstAgeCard.querySelector('.decision-panel .decision-rate')).toBeNull();
    expect(secondAgeCard.querySelector('.decision-panel .decision-rate')).toBeNull();
    expect(firstAgeCard.querySelector('.rate-rail')).toBeNull();
    expect(secondAgeCard.querySelector('.rate-rail')).toBeNull();
    expect(firstAgeCard.querySelector('.selected-sequence-rate')).toBeNull();
    expect(secondAgeCard.querySelector('.selected-sequence-rate')).toBeNull();
    expect(firstAgeCard.querySelector('mat-chip-option.sequence-chip.is-selected')).toBeNull();
    expect(secondAgeCard.querySelector('mat-chip-option.sequence-chip.is-selected')).toBeNull();

    sequenceTwoOption.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const firstSelectedChip = firstAgeCard.querySelector(
      'mat-chip-option.sequence-chip.is-selected',
    ) as HTMLElement;
    const firstSelectedSequenceRate = firstAgeCard.querySelector(
      '.selected-sequence-rate',
    ) as HTMLElement;

    expect(getDefinitionValue(firstGeneralDecision, '中籤率')).toBe('33.3%');
    expect(firstSelectedSequenceRate.textContent).toContain('選取序位中籤率');
    expect(firstSelectedSequenceRate.textContent).toContain('順序2');
    expect(firstSelectedSequenceRate.textContent).toContain('100.0%');
    expect(getProgressValue(firstSelectedSequenceRate)).toBe('100');
    expect(firstSelectedChip.textContent).toContain('順序2');
    expect(firstSelectedChip.querySelector('[role="option"]')?.getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(getDefinitionValue(secondGeneralDecision, '中籤率')).toBe('44.4%');
    expect(secondAgeCard.querySelector('mat-chip-option.sequence-chip.is-selected')).toBeNull();
    expect(secondAgeCard.querySelector('.selected-sequence-rate')).toBeNull();
  });

  it('缺少一般生序位時應保留既有一般中籤率作為預設顯示', async () => {
    const missingGeneralSequenceSchools = buildSchoolLotteryRates({
      臺北市舊序位測試幼兒園: {
        搜尋關鍵字: ['舊序位'],
        '4歲': {
          正取: 5,
          備取: 15,
          公告缺額: 10,
          一般順序: 20,
          一般順序中籤率: 0.25,
          各序位: {
            順序1: 2,
            順序15: 20,
          },
        },
      },
    } satisfies RawLotteryData);
    const fixture = await renderDashboard(() => of(missingGeneralSequenceSchools));
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.value = '舊序位';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const ageCard = host.querySelector('.age-card') as HTMLElement;
    const generalDecision = getGeneralDecision(ageCard);

    expect(getDefinitionValue(generalDecision, '中籤率')).toBe('25.0%');
    expect(ageCard.querySelector('.rate-rail')).toBeNull();
    expect(host.querySelector('.decision-panel .decision-rate')).toBeNull();
    expect(host.querySelector('.selected-sequence-rate')).toBeNull();
    expect(host.querySelector('mat-chip-option.sequence-chip.is-selected')).toBeNull();
  });

  it('按下全域快搜快捷鍵時應聚焦搜尋欄', async () => {
    const fixture = await renderDashboard();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    fixture.detectChanges();

    expect(document.activeElement).toBe(input);
  });

  it('資料服務失敗時應顯示錯誤狀態', async () => {
    const fixture = await renderDashboard(() => throwError(() => new Error('boom')));

    expect(fixture.nativeElement.textContent).toContain('資料載入失敗，先別擔心');
    expect(fixture.nativeElement.textContent).toContain('無法載入 assets/data.json');
  });
});
