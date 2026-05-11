import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';

import {
  LOTTERY_DATA_URL,
  type LotteryRateRecord,
  type SchoolLotteryRates,
} from './lottery-data.model';
import {
  buildLotteryRateRecords,
  buildSchoolLotteryRates,
  searchSchoolLotteryRates,
} from './lottery-data.utils';

@Injectable({
  providedIn: 'root',
})
export class LotteryDataService {
  private readonly http = inject(HttpClient);

  readonly dataUrl = LOTTERY_DATA_URL;

  loadRateRecords(dataUrl = this.dataUrl): Observable<readonly LotteryRateRecord[]> {
    return this.http.get<unknown>(dataUrl).pipe(map(buildLotteryRateRecords));
  }

  loadSchoolRates(dataUrl = this.dataUrl): Observable<readonly SchoolLotteryRates[]> {
    return this.http.get<unknown>(dataUrl).pipe(map(buildSchoolLotteryRates));
  }

  searchSchoolRates(
    schools: readonly SchoolLotteryRates[],
    keyword: string,
  ): ReturnType<typeof searchSchoolLotteryRates> {
    return searchSchoolLotteryRates(schools, keyword);
  }
}
