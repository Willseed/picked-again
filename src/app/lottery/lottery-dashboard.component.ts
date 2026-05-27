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
  effect,
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

type GuidanceStep = 'year' | 'sequence' | 'general';

interface RecordGuidanceAnchor {
  readonly resultIndex: number;
  readonly schoolName: string;
  readonly yearIndex: number;
  readonly recordIndex: number;
}

const GUIDANCE_STEPS = ['year', 'sequence', 'general'] as const satisfies readonly GuidanceStep[];
const GUIDANCE_DISMISSED_STORAGE_KEY = 'picked-again.lottery-dashboard.guidance-dismissed';
const GUIDANCE_TRANSITION_TIMEOUT_MS = 960;
const GUIDANCE_REDUCED_MOTION_TRANSITION_TIMEOUT_MS = 180;

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
  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);
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
  private guidanceFocusFrameId: number | null = null;

  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly dataUrl = this.lotteryDataService.dataUrl;
  protected readonly rateFormula = ESTIMATED_LOTTERY_RATE_FORMULA;
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly schools = signal<readonly SchoolLotteryRates[]>([]);
  protected readonly guidanceYearId = 'lottery-guidance-year';
  protected readonly guidanceSequenceId = 'lottery-guidance-sequence';
  protected readonly guidanceGeneralId = 'lottery-guidance-general';
  private readonly selectedSequenceLabelsByRecordKey = signal<ReadonlyMap<string, string>>(
    new Map(),
  );
  private readonly activeYearIndexesBySchoolName = signal<ReadonlyMap<string, number>>(new Map());
  private readonly guidanceDismissed = signal(readGuidanceDismissed());
  private readonly guidanceStep = signal<GuidanceStep>('year');
  protected readonly guidanceTransitioning = signal(false);
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
  protected readonly isGuidanceOpen = computed(
    () =>
      !this.guidanceDismissed() &&
      !this.loading() &&
      !this.errorMessage() &&
      this.keyword().length > 0 &&
      this.searchResults().length > 0,
  );
  protected readonly guidanceInteractionLocked = computed(() => this.isGuidanceOpen());
  private readonly activeGuidanceStep = computed<GuidanceStep | null>(() => {
    if (!this.isGuidanceOpen()) {
      return null;
    }

    const requestedStep = this.guidanceStep();

    if (requestedStep === 'year' && !this.hasYearGuidanceAnchor()) {
      return this.hasSequenceGuidanceAnchor() ? 'sequence' : 'general';
    }

    if (requestedStep === 'sequence' && !this.hasSequenceGuidanceAnchor()) {
      return 'general';
    }

    return requestedStep;
  });
  protected readonly totalAgeGroups = computed(() =>
    this.schools().reduce((total, school) => total + school.ageGroups.length, 0),
  );
  @ViewChild('searchInput') private readonly searchInput?: ElementRef<HTMLInputElement>;
  @ViewChildren('yearSections') private readonly yearSectionContainers?: QueryList<
    ElementRef<HTMLElement>
  >;
  @ViewChildren('yearSection') private readonly yearSectionElements?: QueryList<
    ElementRef<HTMLElement>
  >;
  private guidanceTransitionTimeoutId: number | null = null;
  private guidanceInitialTransitionCompleted = false;

  constructor() {
    effect(() => {
      const shouldLockSearch = this.guidanceInteractionLocked();

      if (shouldLockSearch && this.searchControl.enabled) {
        this.searchControl.disable({ emitEvent: false });
      } else if (!shouldLockSearch && this.searchControl.disabled) {
        this.searchControl.enable({ emitEvent: false });
      }
    });

    effect(() => {
      if (this.activeGuidanceStep() === null) {
        this.cancelGuidancePrimaryFocus();
        this.cancelGuidanceTransition();
        this.guidanceInitialTransitionCompleted = false;
        return;
      }

      this.scheduleGuidancePrimaryFocus(!this.guidanceInitialTransitionCompleted);
    });

    this.searchControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.activeYearIndexesBySchoolName.set(new Map());
      this.yearSectionHeightsBySchoolName.set(new Map());
      this.scheduleYearSectionsMeasurement();
    });

    this.destroyRef.onDestroy(() => {
      if (this.yearSectionMeasurementFrameId !== null) {
        this.cancelMeasurementFrame(this.yearSectionMeasurementFrameId);
      }
      this.cancelGuidancePrimaryFocus();
      this.cancelGuidanceTransition();

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
    if (this.guidanceInteractionLocked()) {
      return;
    }

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

    if (this.guidanceInteractionLocked()) {
      this.scheduleGuidancePrimaryFocus(false);
      return;
    }

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
    if (this.guidanceInteractionLocked()) {
      return;
    }

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

  protected clearSelectedSequence(record: LotteryRateRecord, event: Event): void {
    if (this.guidanceInteractionLocked()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.type === 'pointerdown') {
      const pointerEvent = event as PointerEvent;

      if (pointerEvent.pointerType === 'touch') {
        event.preventDefault();
      } else {
        return;
      }
    }

    event.stopPropagation();
    const recordKey = getLotteryRateRecordKey(record);

    this.selectedSequenceLabelsByRecordKey.update((selectedSequenceLabels) => {
      const nextSelection = new Map(selectedSequenceLabels);
      nextSelection.delete(recordKey);
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
    if (this.guidanceInteractionLocked()) {
      this.restoreYearSectionsScrollPosition(schoolName, yearGroupCount, event.currentTarget);
      return;
    }

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

  protected guardYearSectionsInteraction(
    schoolName: string,
    yearGroupCount: number,
    event: Event,
  ): void {
    if (!this.guidanceInteractionLocked() || this.isGuidanceControlEvent(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.restoreYearSectionsScrollPosition(schoolName, yearGroupCount, event.currentTarget);
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

  protected canNavigateYear(schoolName: string, yearGroupCount: number, direction: number): boolean {
    const current = this.activeYearIndex(schoolName, yearGroupCount);
    const next = current + direction;
    return next >= 0 && next < yearGroupCount;
  }

  protected navigateYear(schoolName: string, yearGroupCount: number, direction: number): void {
    if (this.guidanceInteractionLocked()) {
      return;
    }

    const current = this.activeYearIndex(schoolName, yearGroupCount);
    const nextIndex = clampIndex(current + direction, yearGroupCount);
    if (nextIndex === current) return;
    const containers = this.yearSectionContainers?.toArray() ?? [];
    const container = containers.find(
      (el) => el.nativeElement.dataset['schoolName'] === schoolName,
    );
    if (!container) return;
    container.nativeElement.scrollTo({
      left: nextIndex * container.nativeElement.clientWidth,
      behavior: 'smooth',
    });
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

  protected skipGuidance(): void {
    this.finishGuidanceTransition();
    writeGuidanceDismissed();
    this.guidanceDismissed.set(true);
  }

  protected advanceGuidance(): void {
    this.finishGuidanceTransition();
    const currentStep = this.activeGuidanceStep() ?? this.guidanceStep();
    const currentIndex = GUIDANCE_STEPS.indexOf(currentStep);
    const nextStep = GUIDANCE_STEPS[currentIndex + 1];

    if (!nextStep) {
      this.skipGuidance();
      return;
    }

    this.guidanceStep.set(nextStep);
  }

  protected guidancePrimaryActionLabel(): string {
    return this.activeGuidanceStep() === 'general' ? '完成' : '下一步';
  }

  protected isYearGuidanceVisible(resultIndex: number, yearGroupCount: number): boolean {
    return (
      this.activeGuidanceStep() === 'year' &&
      resultIndex === this.firstYearGuidanceResultIndex() &&
      yearGroupCount > 1
    );
  }

  protected yearGuidanceDescribedBy(resultIndex: number, yearGroupCount: number): string | null {
    return this.isYearGuidanceVisible(resultIndex, yearGroupCount) ? this.guidanceYearId : null;
  }

  protected isRecordGuidanceVisible(
    step: Exclude<GuidanceStep, 'year'>,
    resultIndex: number,
    schoolName: string,
    yearGroupCount: number,
    yearIndex: number,
    recordIndex: number,
  ): boolean {
    if (this.activeGuidanceStep() !== step) {
      return false;
    }

    if (!this.isActiveYear(schoolName, yearGroupCount, yearIndex)) {
      return false;
    }

    if (step === 'sequence') {
      const anchor = this.firstSequenceGuidanceAnchor();

      return (
        anchor !== null &&
        anchor.resultIndex === resultIndex &&
        anchor.schoolName === schoolName &&
        anchor.yearIndex === yearIndex &&
        anchor.recordIndex === recordIndex
      );
    }

    return resultIndex === 0 && recordIndex === 0;
  }

  protected recordGuidanceDescribedBy(
    step: Exclude<GuidanceStep, 'year'>,
    resultIndex: number,
    schoolName: string,
    yearGroupCount: number,
    yearIndex: number,
    recordIndex: number,
  ): string | null {
    if (
      !this.isRecordGuidanceVisible(
        step,
        resultIndex,
        schoolName,
        yearGroupCount,
        yearIndex,
        recordIndex,
      )
    ) {
      return null;
    }

    return step === 'sequence' ? this.guidanceSequenceId : this.guidanceGeneralId;
  }

  private activeYearIndex(schoolName: string, yearGroupCount: number): number {
    return clampIndex(this.activeYearIndexesBySchoolName().get(schoolName) ?? 0, yearGroupCount);
  }

  private restoreYearSectionsScrollPosition(
    schoolName: string,
    yearGroupCount: number,
    target: EventTarget | null,
  ): void {
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const lockedScrollLeft = this.activeYearIndex(schoolName, yearGroupCount) * target.clientWidth;

    if (target.scrollLeft !== lockedScrollLeft) {
      target.scrollLeft = lockedScrollLeft;
    }
  }

  private isGuidanceControlEvent(event: Event): boolean {
    return event.target instanceof Element && event.target.closest('.guidance-card') !== null;
  }

  private hasYearGuidanceAnchor(): boolean {
    return this.firstYearGuidanceResultIndex() >= 0;
  }

  private firstYearGuidanceResultIndex(): number {
    return this.searchResults().findIndex((result) => this.groupedAgeGroups(result).length > 1);
  }

  private hasSequenceGuidanceAnchor(): boolean {
    return this.firstSequenceGuidanceAnchor() !== null;
  }

  private firstSequenceGuidanceAnchor(): RecordGuidanceAnchor | null {
    for (const [resultIndex, result] of this.searchResults().entries()) {
      const yearGroups = this.groupedAgeGroups(result);
      const yearIndex = this.activeYearIndex(result.schoolName, yearGroups.length);
      const activeYearGroup = yearGroups[yearIndex];
      const recordIndex =
        activeYearGroup?.records.findIndex((record) => record.sequenceCounts.length > 0) ?? -1;

      if (recordIndex >= 0) {
        return {
          resultIndex,
          schoolName: result.schoolName,
          yearIndex,
          recordIndex,
        };
      }
    }

    return null;
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
      this.clearYearSectionHeights();
      return;
    }

    const nextHeights = new Map(this.yearSectionHeightsBySchoolName());
    const visibleSchoolNames = new Set<string>();
    let hasChanged = false;

    for (const { nativeElement } of containers) {
      const measurement = this.measureVisibleYearSection(nativeElement);
      if (measurement === null) continue;
      const [schoolName, measuredHeight] = measurement;
      visibleSchoolNames.add(schoolName);

      if (nextHeights.get(schoolName) !== measuredHeight) {
        nextHeights.set(schoolName, measuredHeight);
        hasChanged = true;
      }
    }

    hasChanged = this.removeHiddenYearSectionHeights(nextHeights, visibleSchoolNames) || hasChanged;

    if (hasChanged) {
      this.yearSectionHeightsBySchoolName.set(nextHeights);
    }
  }

  private clearYearSectionHeights(): void {
    if (this.yearSectionHeightsBySchoolName().size > 0) {
      this.yearSectionHeightsBySchoolName.set(new Map());
    }
  }

  private measureVisibleYearSection(container: HTMLElement): readonly [string, number] | null {
    const schoolName = container.dataset['schoolName'];
    if (!schoolName) return null;

    const activeSection =
      container.querySelector<HTMLElement>('.year-section[data-active-year="true"]') ??
      container.querySelector<HTMLElement>('.year-section');
    if (!activeSection) return null;

    const measuredHeight = measureElementHeight(activeSection);
    return measuredHeight > 0 ? [schoolName, measuredHeight] : null;
  }

  private removeHiddenYearSectionHeights(
    nextHeights: Map<string, number>,
    visibleSchoolNames: ReadonlySet<string>,
  ): boolean {
    let hasChanged = false;

    for (const schoolName of nextHeights.keys()) {
      if (visibleSchoolNames.has(schoolName)) continue;
      nextHeights.delete(schoolName);
      hasChanged = true;
    }

    return hasChanged;
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

  protected finishGuidanceTransition(): void {
    this.cancelGuidanceTransitionTimeout();
    this.guidanceTransitioning.set(false);
  }

  private scheduleGuidancePrimaryFocus(shouldShowTransition: boolean): void {
    this.cancelGuidancePrimaryFocus();
    this.guidanceFocusFrameId = this.requestMeasurementFrame(() => {
      this.guidanceFocusFrameId = null;
      this.focusActiveGuidancePrimary(shouldShowTransition);
    });
  }

  private cancelGuidancePrimaryFocus(): void {
    if (this.guidanceFocusFrameId === null) {
      return;
    }

    this.cancelMeasurementFrame(this.guidanceFocusFrameId);
    this.guidanceFocusFrameId = null;
  }

  private focusActiveGuidancePrimary(shouldShowTransition: boolean): void {
    const activeStep = this.activeGuidanceStep();

    if (activeStep === null) {
      return;
    }

    const primaryButton = this.hostElement.nativeElement.querySelector<HTMLButtonElement>(
      `.guidance-card--${activeStep} .guidance-primary`,
    );

    if (!primaryButton || primaryButton.disabled) {
      return;
    }

    if (shouldShowTransition && !this.guidanceInitialTransitionCompleted) {
      this.startGuidanceTransition();
      this.guidanceInitialTransitionCompleted = true;
    }

    this.scrollActiveGuidanceTargetIntoView(activeStep);

    try {
      primaryButton.focus({ preventScroll: true });
    } catch {
      primaryButton.focus();
    }
  }

  private scrollActiveGuidanceTargetIntoView(activeStep: GuidanceStep): void {
    const activeGuidanceCard = this.hostElement.nativeElement.querySelector<HTMLElement>(
      `.guidance-card--${activeStep}`,
    );
    const activeTarget =
      activeStep === 'year'
        ? activeGuidanceCard?.querySelector<HTMLElement>('.guidance-primary') ??
          activeGuidanceCard?.closest<HTMLElement>('.is-guidance-target') ??
          activeGuidanceCard
        : activeGuidanceCard?.closest<HTMLElement>('.is-guidance-target') ?? activeGuidanceCard;

    if (!activeTarget || typeof activeTarget.scrollIntoView !== 'function') {
      return;
    }

    activeTarget.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: this.prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }

  private startGuidanceTransition(): void {
    this.cancelGuidanceTransitionTimeout();
    this.guidanceTransitioning.set(true);
    this.guidanceTransitionTimeoutId = globalThis.setTimeout(
      () => this.finishGuidanceTransition(),
      this.prefersReducedMotion()
        ? GUIDANCE_REDUCED_MOTION_TRANSITION_TIMEOUT_MS
        : GUIDANCE_TRANSITION_TIMEOUT_MS,
    );
  }

  private cancelGuidanceTransition(): void {
    this.cancelGuidanceTransitionTimeout();
    this.guidanceTransitioning.set(false);
  }

  private cancelGuidanceTransitionTimeout(): void {
    if (this.guidanceTransitionTimeoutId === null) {
      return;
    }

    clearTimeout(this.guidanceTransitionTimeoutId);
    this.guidanceTransitionTimeoutId = null;
  }

  private prefersReducedMotion(): boolean {
    return (
      typeof globalThis.matchMedia === 'function' &&
      globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  private requestMeasurementFrame(callback: FrameRequestCallback): number {
    if (typeof requestAnimationFrame === 'function') {
      return requestAnimationFrame(callback);
    }

    return globalThis.setTimeout(() => callback(performance.now()), 0);
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
  const match = /\d+/u.exec(label);

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

function readGuidanceDismissed(): boolean {
  try {
    return getSafeLocalStorage()?.getItem(GUIDANCE_DISMISSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeGuidanceDismissed(): void {
  try {
    getSafeLocalStorage()?.setItem(GUIDANCE_DISMISSED_STORAGE_KEY, 'true');
  } catch {
    // Ignore storage failures so the UI remains usable in private or test contexts.
  }
}

function getSafeLocalStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    const probeKey = `${GUIDANCE_DISMISSED_STORAGE_KEY}.probe`;

    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);

    return storage;
  } catch {
    return null;
  }
}
