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

  it('shows a loading state while data is pending', async () => {
    const pendingSchools = new Subject<readonly SchoolLotteryRates[]>();
    const fixture = await renderDashboard(() => pendingSchools.asObservable());

    expect(fixture.nativeElement.textContent).toContain('載入資料中');

    pendingSchools.complete();
  });

  it('prompts for a keyword after data loads', async () => {
    const fixture = await renderDashboard();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('輸入關鍵字開始搜尋');
    expect(text).toContain('1 間學校');
    expect(text).toContain('4 個班齡組別');
  });

  it('renders matched schools with rates and 正取/備取 counts', async () => {
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
  });

  it('shows an error state when the data service fails', async () => {
    const fixture = await renderDashboard(() => throwError(() => new Error('boom')));

    expect(fixture.nativeElement.textContent).toContain('資料載入失敗');
    expect(fixture.nativeElement.textContent).toContain('無法載入 /assets/data.json');
  });
});
