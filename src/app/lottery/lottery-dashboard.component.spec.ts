import { TestBed } from '@angular/core/testing';
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

function createServiceMock(loadSchoolRates: () => Observable<readonly SchoolLotteryRates[]>) {
  return {
    dataUrl: 'assets/data.json',
    loadSchoolRates,
    searchSchoolRates: (schools: readonly SchoolLotteryRates[], keyword: string) =>
      searchSchoolLotteryRates(schools, keyword),
  } satisfies Partial<LotteryDataService>;
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

describe('LotteryDashboardComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

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

  it('應顯示符合幼兒園的中籤率與正取／備取人數', async () => {
    const fixture = await renderDashboard();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.value = '蘭州';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('臺北市蘭州非營利幼兒園');
    expect(text).toContain('5歲');
    expect(text).toContain('25.0%');
    expect(text).toContain('正取');
    expect(text).toContain('備取');
    expect(text).toContain('班齡組別');
    expect(fixture.nativeElement.querySelector('.metric-grid')?.textContent).not.toContain(
      '班齡組別',
    );
    expect(fixture.nativeElement.querySelector('.district-chips')?.textContent).toContain(
      '大同區',
    );
  });

  it('公告缺額與總登記人數應以小字顯示在一般中籤率上方', async () => {
    const announcedCountSchools = buildSchoolLotteryRates({
      臺北市公告資訊測試幼兒園: {
        搜尋關鍵字: ['公告資訊測試'],
        '4歲': {
          正取: 10,
          備取: 5,
          公告缺額: 8,
          總登記人數: 20,
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
    const decisionContext = host.querySelector('.decision-context') as HTMLElement;
    const decisionRate = host.querySelector('.decision-rate') as HTMLElement;
    const detailGrid = host.querySelector('.detail-grid') as HTMLElement;

    expect(decisionContext.textContent).toContain('公告缺額');
    expect(decisionContext.textContent).toContain('8');
    expect(decisionContext.textContent).toContain('總登記人數');
    expect(decisionContext.textContent).toContain('20');
    expect(
      decisionContext.compareDocumentPosition(decisionRate) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(detailGrid.textContent).not.toContain('公告缺額');
    expect(detailGrid.textContent).not.toContain('總登記');
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
    expect(fixture.nativeElement.querySelector('.district-chips')?.textContent).toContain(
      '大同區',
    );
  });

  it('應依學年度拆開班齡資料並醒目顯示年度標籤', async () => {
    const yearSplitSchools = buildSchoolLotteryRates({
      臺北市測試非營利幼兒園: {
        搜尋關鍵字: ['測試', '大同區'],
        '5歲（114學年）': { 正取: 1, 備取: 1 },
        '4歲（113學年）': { 正取: 2, 備取: 2 },
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
    const yearSections = Array.from(host.querySelectorAll('.year-section')) as HTMLElement[];
    const yearLabels = Array.from(host.querySelectorAll('.year-tag')).map((element) =>
      element.textContent?.trim(),
    );
    const contextSchools = Array.from(host.querySelectorAll('.year-context-school')).map(
      (element) => element.textContent?.trim(),
    );

    expect(yearSections).toHaveLength(2);
    expect(yearLabels).toEqual(['114學年', '113學年']);
    expect(contextSchools).toEqual([
      '臺北市測試非營利幼兒園',
      '臺北市測試非營利幼兒園',
    ]);
    expect(yearSections[0]?.textContent).toContain('5歲');
    expect(yearSections[1]?.textContent).toContain('4歲');
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
    const highlightedChip = host.querySelector('.sequence-chip.is-fill-threshold');

    expect(highlightedChip?.textContent).toContain('順序7');
    expect(highlightedChip?.textContent).toContain('收滿點');
    expect(host.querySelector('.sequence-fulfillment-hint')?.textContent).toContain(
      '在順序7已達收滿門檻',
    );
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
