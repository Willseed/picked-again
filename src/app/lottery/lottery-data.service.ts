import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, throwError, type Observable } from 'rxjs';

import {
  FALLBACK_DATA_URL,
  REMOTE_DATA_URL,
  REMOTE_DATA_URLS,
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
  readonly remoteDataUrls: readonly string[] = REMOTE_DATA_URLS;
  readonly fallbackDataUrl: string = FALLBACK_DATA_URL;
  readonly dataUrl: string = this.remoteDataUrl;

  loadRateRecords(dataUrl = this.dataUrl): Observable<readonly LotteryRateRecord[]> {
    return this.loadRawLotteryData(dataUrl).pipe(map(buildLotteryRateRecords));
  }

  loadSchoolRates(dataUrl = this.dataUrl): Observable<readonly SchoolLotteryRates[]> {
    return this.loadRawLotteryData(dataUrl).pipe(map(buildSchoolLotteryRates));
  }

  private loadRawLotteryData(dataUrl: string): Observable<unknown> {
    return this.loadFirstAvailableRawLotteryData(this.getDataUrlCandidates(dataUrl)).pipe(
      map(coerceRawLotteryData),
    );
  }

  private getDataUrlCandidates(dataUrl: string): readonly string[] {
    if (!this.remoteDataUrls.includes(dataUrl)) {
      return [dataUrl];
    }

    return [
      dataUrl,
      ...this.remoteDataUrls.filter((remoteDataUrl) => remoteDataUrl !== dataUrl),
      this.fallbackDataUrl,
    ];
  }

  private loadFirstAvailableRawLotteryData(
    dataUrls: readonly string[],
    dataUrlIndex = 0,
  ): Observable<unknown> {
    const dataUrl = dataUrls[dataUrlIndex];

    if (dataUrl === undefined) {
      return throwError(() => new Error('No lottery data URL candidates configured'));
    }

    return this.http.get<unknown>(dataUrl, this.getRequestOptions(dataUrl)).pipe(
      catchError((error: unknown) => {
        const nextDataUrlIndex = dataUrlIndex + 1;

        if (nextDataUrlIndex >= dataUrls.length) {
          return throwError(() => error);
        }

        return this.loadFirstAvailableRawLotteryData(dataUrls, nextDataUrlIndex);
      }),
    );
  }

  private getRequestOptions(dataUrl: string): { readonly cache?: RequestCache } {
    return dataUrl === this.fallbackDataUrl ? {} : { cache: 'no-store' };
  }

  searchSchoolRates(
    schools: readonly SchoolLotteryRates[],
    keyword: string,
  ): ReturnType<typeof searchSchoolLotteryRates> {
    return searchSchoolLotteryRates(schools, keyword);
  }
}
