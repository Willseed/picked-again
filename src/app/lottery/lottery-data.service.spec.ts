import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  FALLBACK_DATA_URL,
  REMOTE_DATA_URL,
  type RawLotteryData,
  type SchoolLotteryRates,
} from './lottery-data.model';
import { LotteryDataService } from './lottery-data.service';

describe('LotteryDataService', () => {
  let service: LotteryDataService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(LotteryDataService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('應優先從 Worker API 載入歷史抽籤資料', () => {
    const remoteData = {
      臺北市雲端幼兒園: {
        搜尋關鍵字: ['大同區'],
        '5歲（114學年）': { 正取: 10, 備取: 15 },
        '5歲（113學年）': { 正取: 8, 備取: 12 },
      },
    } satisfies RawLotteryData;
    const results: (readonly SchoolLotteryRates[])[] = [];

    service.loadSchoolRates().subscribe((schools) => results.push(schools));

    const remoteRequest = httpTesting.expectOne(REMOTE_DATA_URL);
    expect(remoteRequest.request.method).toBe('GET');
    expect(remoteRequest.request.url).toContain('/kindergarten/lottery-data');
    remoteRequest.flush(remoteData);

    httpTesting.expectNone(FALLBACK_DATA_URL);
    expect(results[0]?.[0]?.schoolName).toBe('臺北市雲端幼兒園');
    expect(results[0]?.[0]?.ageGroups.map((group) => group.ageGroup).sort()).toEqual([
      '5歲（113學年）',
      '5歲（114學年）',
    ]);
    expect(results[0]?.[0]?.ageGroups[0]?.estimatedLotteryRatePercent).toBeCloseTo(40);
  });

  it('Worker API 失敗時應改用 assets/data.json fallback', () => {
    const fallbackData = {
      臺北市備援幼兒園: {
        搜尋關鍵字: ['中正區'],
        '5歲': { 正取: 2, 備取: 6 },
      },
    } satisfies RawLotteryData;
    const results: (readonly SchoolLotteryRates[])[] = [];

    service.loadSchoolRates().subscribe((schools) => results.push(schools));

    const remoteRequest = httpTesting.expectOne(REMOTE_DATA_URL);
    remoteRequest.flush(null, { status: 500, statusText: 'Worker Error' });

    const fallbackRequest = httpTesting.expectOne(FALLBACK_DATA_URL);
    expect(fallbackRequest.request.method).toBe('GET');
    fallbackRequest.flush(fallbackData);

    expect(results[0]?.[0]?.schoolName).toBe('臺北市備援幼兒園');
    expect(results[0]?.[0]?.ageGroups[0]?.estimatedLotteryRatePercent).toBeCloseTo(25);
  });

  it('Worker API 與 fallback 都失敗時應將 fallback 錯誤傳給 subscriber', () => {
    const results: (readonly SchoolLotteryRates[])[] = [];
    const errors: unknown[] = [];

    service.loadSchoolRates().subscribe({
      next: (schools) => results.push(schools),
      error: (error: unknown) => errors.push(error),
    });

    const remoteRequest = httpTesting.expectOne(REMOTE_DATA_URL);
    remoteRequest.flush(null, { status: 500, statusText: 'Worker Error' });

    const fallbackRequest = httpTesting.expectOne(FALLBACK_DATA_URL);
    fallbackRequest.flush(null, { status: 404, statusText: 'Missing fallback' });

    expect(results).toEqual([]);
    expect(errors[0]).toBeInstanceOf(HttpErrorResponse);
    expect((errors[0] as HttpErrorResponse).status).toBe(404);
  });
});
