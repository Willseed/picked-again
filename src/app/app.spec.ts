import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { App } from './app';
import type { RawLotteryData, SchoolLotteryRates } from './lottery/lottery-data.model';
import { LotteryDataService } from './lottery/lottery-data.service';
import { buildSchoolLotteryRates, searchSchoolLotteryRates } from './lottery/lottery-data.utils';

const sampleSchools = buildSchoolLotteryRates({
  臺北市蘭州非營利幼兒園: {
    '5歲': { 正取: 1, 備取: 3 },
  },
} satisfies RawLotteryData);

const lotteryDataServiceStub = {
  dataUrl: '/assets/data.json',
  loadSchoolRates: () => of(sampleSchools),
  searchSchoolRates: (schools: readonly SchoolLotteryRates[], keyword: string) =>
    searchSchoolLotteryRates(schools, keyword),
} satisfies Partial<LotteryDataService>;

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: LotteryDataService, useValue: lotteryDataServiceStub }],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Picked Again');
    expect(compiled.textContent).toContain('Lottery success rates dashboard');
    expect(compiled.textContent).toContain('輸入關鍵字開始搜尋');
  });
});
