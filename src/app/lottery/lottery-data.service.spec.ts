import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  FALLBACK_DATA_URL,
  REMOTE_DATA_URL,
  type KindergartenDataset,
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

  it('應優先載入 Worker API 並轉換 schemaVersion 2 資料', () => {
    const results: (readonly SchoolLotteryRates[])[] = [];

    service.loadSchoolRates().subscribe((schools) => results.push(schools));

    const remoteRequest = httpTesting.expectOne(REMOTE_DATA_URL);
    expect(remoteRequest.request.method).toBe('GET');
    remoteRequest.flush(workerDataset);

    httpTesting.expectNone(FALLBACK_DATA_URL);
    expect(results[0]?.[0]?.schoolName).toBe('臺北市雲端幼兒園');
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

const workerDataset = {
  schemaVersion: 2,
  source: 'cloudflare-worker',
  updatedAt: '2026-05-26T00:00:00.000Z',
  timezone: 'Asia/Taipei',
  public: {
    type: 'public',
    name: '公立幼兒園',
    baseUrl: 'https://example.test/public',
    updatedAt: '2026-05-26T00:00:00.000Z',
    districts: [
      {
        districtCode: '103',
        districtName: '大同區',
        classes: [
          {
            className: '5歲',
            fetchedAt: '2026-05-26T00:00:00.000Z',
            sourceUrl: 'https://example.test/public/5',
            items: [
              {
                id: 'public-103-5-1',
                schoolName: '臺北市雲端幼兒園',
                districtCode: '103',
                districtName: '大同區',
                sourceType: 'public',
                className: '5歲',
                availableQuota: 10,
                waitingCount: 15,
              },
            ],
          },
        ],
      },
    ],
  },
  nonProfit: {
    type: 'nonProfit',
    name: '非營利幼兒園',
    baseUrl: 'https://example.test/nonprofit',
    updatedAt: '2026-05-26T00:00:00.000Z',
    districts: [],
  },
} satisfies KindergartenDataset;
