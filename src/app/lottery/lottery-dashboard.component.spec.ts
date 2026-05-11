import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';

import { LotteryDashboardComponent } from './lottery-dashboard.component';
import type { RawLotteryData, SchoolLotteryRates } from './lottery-data.model';
import { LotteryDataService } from './lottery-data.service';
import { buildSchoolLotteryRates, searchSchoolLotteryRates } from './lottery-data.utils';

const sampleData = {
  臺北市蘭州非營利幼兒園: {
    '5歲': { 正取: 1, 備取: 3 },
    '4歲': { 正取: 9, 備取: 2 },
    '3歲': { 正取: 24, 備取: 22 },
    '2歲專班': { 正取: 16, 備取: 39 },
  },
} satisfies RawLotteryData;

const sampleSchools = buildSchoolLotteryRates(sampleData);

function createServiceMock(loadSchoolRates: () => Observable<readonly SchoolLotteryRates[]>) {
  return {
    dataUrl: '/assets/data.json',
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

    expect(fixture.nativeElement.textContent).toContain('載入抽籤宇宙中');

    pendingSchools.complete();
  });

  it('資料載入後應提示輸入關鍵字', async () => {
    const fixture = await renderDashboard();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('輸入關鍵字，開始查榜前深呼吸');
    expect(text).toContain('1 間幼兒園待命');
    expect(text).toContain('4 個班齡戰場');
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
    expect(text).toContain('班齡戰場');
  });

  it('資料服務失敗時應顯示錯誤狀態', async () => {
    const fixture = await renderDashboard(() => throwError(() => new Error('boom')));

    expect(fixture.nativeElement.textContent).toContain('資料載入失敗，焦慮先別加碼');
    expect(fixture.nativeElement.textContent).toContain('無法載入 /assets/data.json');
  });
});
