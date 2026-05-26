import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, type Observable } from 'rxjs';

import {
  FALLBACK_DATA_URL,
  REMOTE_DATA_URL,
  type LotteryRateRecord,
  type SchoolLotteryRates,
} from './lottery-data.model';
import {
  buildLotteryRateRecords,
  buildSchoolLotteryRates,
  coerceRawLotteryData,
  searchSchoolLotteryRates,
} from './lottery-data.utils';

@Injectable({
  providedIn: 'root',
})
export class LotteryDataService {
  private readonly http = inject(HttpClient);

  readonly remoteDataUrl: string = REMOTE_DATA_URL;
  readonly fallbackDataUrl: string = FALLBACK_DATA_URL;
  readonly dataUrl: string = this.remoteDataUrl;

  loadRateRecords(dataUrl = this.dataUrl): Observable<readonly LotteryRateRecord[]> {
    return this.loadRawLotteryData(dataUrl).pipe(map(buildLotteryRateRecords));
  }

  loadSchoolRates(dataUrl = this.dataUrl): Observable<readonly SchoolLotteryRates[]> {
    return this.loadRawLotteryData(dataUrl).pipe(map(buildSchoolLotteryRates));
  }

  private loadRawLotteryData(dataUrl: string): Observable<unknown> {
    const request = this.http.get<unknown>(dataUrl);
    const source =
      dataUrl === this.remoteDataUrl
        ? request.pipe(catchError(() => this.http.get<unknown>(this.fallbackDataUrl)))
        : request;

    return source.pipe(map(coerceRawLotteryData));
  }

  searchSchoolRates(
    schools: readonly SchoolLotteryRates[],
    keyword: string,
  ): ReturnType<typeof searchSchoolLotteryRates> {
    return searchSchoolLotteryRates(schools, keyword);
  }
}
