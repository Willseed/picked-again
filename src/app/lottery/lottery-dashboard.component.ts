import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { map, startWith } from 'rxjs';

import {
  ESTIMATED_LOTTERY_RATE_FORMULA,
  type LotteryRateRecord,
  type SchoolLotteryRates,
} from './lottery-data.model';
import { LotteryDataService } from './lottery-data.service';

@Component({
  selector: 'app-lottery-dashboard',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  templateUrl: './lottery-dashboard.component.html',
  styleUrl: './lottery-dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LotteryDashboardComponent {
  private readonly lotteryDataService = inject(LotteryDataService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly percentFormatter = new Intl.NumberFormat('zh-TW', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });

  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly dataUrl = this.lotteryDataService.dataUrl;
  protected readonly rateFormula = ESTIMATED_LOTTERY_RATE_FORMULA;
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly schools = signal<readonly SchoolLotteryRates[]>([]);
  protected readonly keyword = toSignal(
    this.searchControl.valueChanges.pipe(
      startWith(this.searchControl.value),
      map((value) => value.trim()),
    ),
    { initialValue: this.searchControl.value.trim() },
  );
  protected readonly searchResults = computed(() =>
    this.lotteryDataService.searchSchoolRates(this.schools(), this.keyword()),
  );
  protected readonly totalAgeGroups = computed(() =>
    this.schools().reduce((total, school) => total + school.ageGroups.length, 0),
  );
  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  constructor() {
    this.loadData();
  }

  protected clearSearch(): void {
    this.searchControl.setValue('');
  }

  protected retryLoad(): void {
    this.loadData();
  }

  @HostListener('window:keydown', ['$event'])
  protected handleGlobalSearchShortcut(event: KeyboardEvent): void {
    if (event.key.toLocaleLowerCase('en-US') !== 'k' || (!event.metaKey && !event.ctrlKey)) {
      return;
    }

    event.preventDefault();
    this.searchInput?.nativeElement.focus();
  }

  protected formatPercent(value: number | null): string {
    return value === null
      ? '無法估算，命運連公式都不想接'
      : `${this.percentFormatter.format(value)}%`;
  }

  protected formatMatchScore(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  protected rateProgressValue(record: LotteryRateRecord): number {
    return record.generalLotteryRatePercent ?? record.estimatedLotteryRatePercent ?? 0;
  }

  protected formatCount(value: number | null): string {
    return value === null ? '—' : `${value}`;
  }

  protected acceptedTotal(school: SchoolLotteryRates): number {
    return school.ageGroups.reduce((total, record) => total + record.acceptedCount, 0);
  }

  protected waitlistedTotal(school: SchoolLotteryRates): number {
    return school.ageGroups.reduce((total, record) => total + record.waitlistedCount, 0);
  }

  private loadData(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.lotteryDataService
      .loadSchoolRates()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (schools) => {
          this.schools.set(schools);
          this.loading.set(false);
        },
        error: () => {
          this.schools.set([]);
          this.errorMessage.set(
            `無法載入 ${this.dataUrl}。請確認資料檔存在且格式正確；不是每個崩潰都能怪抽籤。`,
          );
          this.loading.set(false);
        },
      });
  }
}
