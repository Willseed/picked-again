import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  QueryList,
  ViewChild,
  ViewChildren,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import type { MatChipListboxChange } from '@angular/material/chips';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { map, startWith } from 'rxjs';

import {
  ESTIMATED_LOTTERY_RATE_FORMULA,
  type LotteryRateRecord,
  type LotterySequenceRate,
  type SchoolLotteryRates,
} from './lottery-data.model';
import { LotteryDataService } from './lottery-data.service';
import {
  calculateSelectedSequenceLotteryRate,
  hasLotterySequenceLabel,
} from './lottery-data.utils';

interface SchoolYearLotteryGroup {
  readonly schoolYear: string;
  readonly records: readonly LotteryRateRecord[];
}

interface SequenceFulfillmentMarker {
  readonly label: string;
  readonly cumulativeCount: number;
}

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
export class LotteryDashboardComponent implements AfterViewInit {
  private readonly lotteryDataService = inject(LotteryDataService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly yearSectionHeightsBySchoolName = signal<ReadonlyMap<string, number>>(new Map());
  private readonly yearSectionResizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => this.scheduleYearSectionsMeasurement());
  private readonly percentFormatter = new Intl.NumberFormat('zh-TW', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
  private yearSectionMeasurementFrameId: number | null = null;

  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly dataUrl = this.lotteryDataService.dataUrl;
  protected readonly rateFormula = ESTIMATED_LOTTERY_RATE_FORMULA;
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly schools = signal<readonly SchoolLotteryRates[]>([]);
  private readonly selectedSequenceLabelsByRecordKey = signal<ReadonlyMap<string, string>>(
    new Map(),
  );
  private readonly activeYearIndexesBySchoolName = signal<ReadonlyMap<string, number>>(new Map());
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
  @ViewChildren('yearSections') private yearSectionContainers?: QueryList<
    ElementRef<HTMLElement>
  >;
  @ViewChildren('yearSection') private yearSectionElements?: QueryList<ElementRef<HTMLElement>>;

  constructor() {
    this.searchControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.activeYearIndexesBySchoolName.set(new Map());
      this.yearSectionHeightsBySchoolName.set(new Map());
      this.scheduleYearSectionsMeasurement();
    });

    this.destroyRef.onDestroy(() => {
      if (this.yearSectionMeasurementFrameId !== null) {
        this.cancelMeasurementFrame(this.yearSectionMeasurementFrameId);
      }

      this.yearSectionResizeObserver?.disconnect();
    });

    this.loadData();
  }

  ngAfterViewInit(): void {
    this.yearSectionContainers?.changes
      .pipe(startWith(this.yearSectionContainers), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.scheduleYearSectionsMeasurement());
    this.yearSectionElements?.changes
      .pipe(startWith(this.yearSectionElements), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.observeYearSectionsForResize();
        this.scheduleYearSectionsMeasurement();
      });

    this.observeYearSectionsForResize();
    this.scheduleYearSectionsMeasurement();
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

  @HostListener('window:resize')
  protected handleWindowResize(): void {
    this.scheduleYearSectionsMeasurement();
  }

  protected formatPercent(value: number | null): string {
    return value === null ? '無法估算' : `${this.percentFormatter.format(value)}%`;
  }

  protected formatPercentHint(value: number | null): string | null {
    return value === null ? '沒有申請人或缺少有效公告資訊，暫時無法估算' : null;
  }

  protected formatMatchScore(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  protected progressValue(ratePercent: number | null): number {
    return ratePercent ?? 0;
  }

  protected formatCount(value: number | null): string {
    return value === null ? '—' : `${value}`;
  }

  protected sequenceFulfillmentMarker(record: LotteryRateRecord): SequenceFulfillmentMarker | null {
    return findSequenceFulfillmentMarker(record);
  }

  protected selectedSequenceLabel(record: LotteryRateRecord): string | null {
    const explicitSequenceLabel = this.selectedSequenceLabelsByRecordKey().get(
      getLotteryRateRecordKey(record),
    );

    if (
      explicitSequenceLabel &&
      hasLotterySequenceLabel(record.sequenceCounts, explicitSequenceLabel)
    ) {
      return explicitSequenceLabel;
    }

    return null;
  }

  protected isSequenceSelected(record: LotteryRateRecord, sequenceLabel: string): boolean {
    return this.selectedSequenceLabel(record) === sequenceLabel;
  }

  protected selectSequence(record: LotteryRateRecord, event: MatChipListboxChange): void {
    const recordKey = getLotteryRateRecordKey(record);
    const nextSequenceLabel = typeof event.value === 'string' ? event.value : null;

    this.selectedSequenceLabelsByRecordKey.update((selectedSequenceLabels) => {
      const nextSelection = new Map(selectedSequenceLabels);
      const selectedSequenceLabel = nextSelection.get(recordKey) ?? null;

      if (nextSequenceLabel === null || selectedSequenceLabel === nextSequenceLabel) {
        nextSelection.delete(recordKey);
      } else {
        nextSelection.set(recordKey, nextSequenceLabel);
      }

      return nextSelection;
    });
    this.scheduleYearSectionsMeasurement();
  }

  protected sequenceAriaLabel(
    record: LotteryRateRecord,
    sequenceLabel: string,
    sequenceCount: number,
  ): string {
    const selectedPrefix = this.isSequenceSelected(record, sequenceLabel) ? '目前選取，' : '';

    return `${selectedPrefix}${sequenceLabel}，${sequenceCount} 人，選擇後顯示選取序位中籤率`;
  }

  protected generalDisplayRatePercent(record: LotteryRateRecord): number | null {
    return record.generalLotteryRatePercent ?? record.estimatedLotteryRatePercent;
  }

  protected generalDisplayAcceptedCount(record: LotteryRateRecord): number | null {
    return record.generalAcceptedCount ?? record.acceptedCount;
  }

  protected selectedSequenceRate(record: LotteryRateRecord): LotterySequenceRate | null {
    const selectedSequenceLabel = this.selectedSequenceLabel(record);

    if (!selectedSequenceLabel) {
      return null;
    }

    return calculateSelectedSequenceLotteryRate({
      announcedVacancyCount: record.announcedVacancyCount,
      sequenceCounts: record.sequenceCounts,
      selectedSequenceLabel,
    });
  }

  protected groupedAgeGroups(school: SchoolLotteryRates): readonly SchoolYearLotteryGroup[] {
    const groups = new Map<string, LotteryRateRecord[]>();

    for (const record of school.ageGroups) {
      const schoolYear = record.schoolYear ?? '未標示學年';
      const existingRecords = groups.get(schoolYear);

      if (existingRecords) {
        existingRecords.push(record);
      } else {
        groups.set(schoolYear, [record]);
      }
    }

    return Array.from(groups.entries())
      .map(([schoolYear, records]) => ({ schoolYear, records }))
      .sort((left, right) => compareSchoolYearLabels(right.schoolYear, left.schoolYear));
  }

  protected updateActiveYearIndex(schoolName: string, yearGroupCount: number, event: Event): void {
    const target = event.currentTarget as HTMLElement | null;

    if (!target || yearGroupCount <= 1 || target.clientWidth <= 0) {
      return;
    }

    const nextIndex = clampIndex(
      Math.round(target.scrollLeft / target.clientWidth),
      yearGroupCount,
    );

    if (this.activeYearIndex(schoolName, yearGroupCount) === nextIndex) {
      this.scheduleYearSectionsMeasurement();
      return;
    }

    this.activeYearIndexesBySchoolName.update((activeYearIndexes) => {
      const nextActiveYearIndexes = new Map(activeYearIndexes);

      nextActiveYearIndexes.set(schoolName, nextIndex);

      return nextActiveYearIndexes;
    });
    this.scheduleYearSectionsMeasurement();
  }

  protected yearHeaderTrackTransform(schoolName: string, yearGroupCount: number): string {
    return `translateX(-${this.activeYearIndex(schoolName, yearGroupCount) * 100}%)`;
  }

  protected yearSectionsHeight(schoolName: string): string | null {
    const measuredHeight = this.yearSectionHeightsBySchoolName().get(schoolName);

    return measuredHeight === undefined ? null : `${measuredHeight}px`;
  }

  protected isActiveYear(schoolName: string, yearGroupCount: number, yearIndex: number): boolean {
    return this.activeYearIndex(schoolName, yearGroupCount) === yearIndex;
  }

  private loadData(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.lotteryDataService
      .loadSchoolRates()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (schools) => {
          this.selectedSequenceLabelsByRecordKey.set(new Map());
          this.activeYearIndexesBySchoolName.set(new Map());
          this.yearSectionHeightsBySchoolName.set(new Map());
          this.schools.set(schools);
          this.loading.set(false);
          this.scheduleYearSectionsMeasurement();
        },
        error: () => {
          this.schools.set([]);
          this.yearSectionHeightsBySchoolName.set(new Map());
          this.errorMessage.set(`無法載入 ${this.dataUrl}。請確認資料檔存在且格式正確後再試一次。`);
          this.loading.set(false);
        },
      });
  }

  private activeYearIndex(schoolName: string, yearGroupCount: number): number {
    return clampIndex(this.activeYearIndexesBySchoolName().get(schoolName) ?? 0, yearGroupCount);
  }

  private scheduleYearSectionsMeasurement(): void {
    if (this.yearSectionMeasurementFrameId !== null) {
      return;
    }

    this.yearSectionMeasurementFrameId = this.requestMeasurementFrame(() => {
      this.yearSectionMeasurementFrameId = null;
      this.measureYearSections();
    });
  }

  private measureYearSections(): void {
    const containers = this.yearSectionContainers?.toArray() ?? [];

    if (containers.length === 0) {
      if (this.yearSectionHeightsBySchoolName().size > 0) {
        this.yearSectionHeightsBySchoolName.set(new Map());
      }

      return;
    }

    const nextHeights = new Map(this.yearSectionHeightsBySchoolName());
    const visibleSchoolNames = new Set<string>();
    let hasChanged = false;

    for (const { nativeElement: container } of containers) {
      const schoolName = container.dataset['schoolName'];

      if (!schoolName) {
        continue;
      }

      visibleSchoolNames.add(schoolName);

      const activeSection =
        container.querySelector<HTMLElement>('.year-section[data-active-year="true"]') ??
        container.querySelector<HTMLElement>('.year-section');

      if (!activeSection) {
        continue;
      }

      const measuredHeight = measureElementHeight(activeSection);

      if (measuredHeight <= 0) {
        continue;
      }

      if (nextHeights.get(schoolName) !== measuredHeight) {
        nextHeights.set(schoolName, measuredHeight);
        hasChanged = true;
      }
    }

    for (const schoolName of nextHeights.keys()) {
      if (!visibleSchoolNames.has(schoolName)) {
        nextHeights.delete(schoolName);
        hasChanged = true;
      }
    }

    if (hasChanged) {
      this.yearSectionHeightsBySchoolName.set(nextHeights);
    }
  }

  private observeYearSectionsForResize(): void {
    if (!this.yearSectionResizeObserver) {
      return;
    }

    this.yearSectionResizeObserver.disconnect();

    for (const { nativeElement: yearSection } of this.yearSectionElements?.toArray() ?? []) {
      this.yearSectionResizeObserver.observe(yearSection);
    }
  }

  private requestMeasurementFrame(callback: FrameRequestCallback): number {
    if (typeof requestAnimationFrame === 'function') {
      return requestAnimationFrame(callback);
    }

    return window.setTimeout(() => callback(performance.now()), 0);
  }

  private cancelMeasurementFrame(frameId: number): void {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameId);
      return;
    }

    clearTimeout(frameId);
  }
}

function measureElementHeight(element: HTMLElement): number {
  return Math.ceil(
    Math.max(element.offsetHeight, element.scrollHeight, element.getBoundingClientRect().height),
  );
}

function compareSchoolYearLabels(left: string, right: string): number {
  const leftYear = extractNumericYear(left);
  const rightYear = extractNumericYear(right);

  if (leftYear !== null && rightYear !== null && leftYear !== rightYear) {
    return leftYear - rightYear;
  }

  if (leftYear !== null && rightYear === null) {
    return 1;
  }

  if (leftYear === null && rightYear !== null) {
    return -1;
  }

  return left.localeCompare(right, 'zh-Hant');
}

function extractNumericYear(label: string): number | null {
  const match = label.match(/\d+/u);

  return match ? Number(match[0]) : null;
}

function clampIndex(index: number, itemCount: number): number {
  return Math.min(Math.max(index, 0), Math.max(itemCount - 1, 0));
}

function getLotteryRateRecordKey(record: LotteryRateRecord): string {
  return `${record.schoolName}\u0000${record.ageGroup}`;
}

function findSequenceFulfillmentMarker(
  record: LotteryRateRecord,
): SequenceFulfillmentMarker | null {
  const announcedVacancyCount = record.announcedVacancyCount;

  if (
    announcedVacancyCount === null ||
    announcedVacancyCount <= 0 ||
    record.sequenceCounts.length === 0
  ) {
    return null;
  }

  let cumulativeCount = 0;

  for (const sequence of record.sequenceCounts) {
    cumulativeCount += sequence.count;

    if (cumulativeCount >= announcedVacancyCount) {
      return {
        label: sequence.label,
        cumulativeCount,
      };
    }
  }

  return null;
}
