export const LOTTERY_DATA_URL = 'assets/data.json';

export const ESTIMATED_LOTTERY_RATE_LABEL = '估算中籤率（快速參考）';
export const ESTIMATED_LOTTERY_RATE_FORMULA = '正取 ÷ (正取 + 備取)';
export const SEARCH_KEYWORDS_FIELD = '搜尋關鍵字';

export type LotteryCountField = '正取' | '備取';

export interface RawLotteryCounts {
  readonly 正取?: unknown;
  readonly 備取?: unknown;
  readonly 公告缺額?: unknown;
  readonly 總登記人數?: unknown;
  readonly 各序位?: unknown;
  readonly 身份別?: unknown;
  readonly 優先順序?: unknown;
  readonly 一般缺額?: unknown;
  readonly 一般順序?: unknown;
  readonly 一般順序中籤率?: unknown;
  readonly 資料來源?: unknown;
  readonly 備註?: unknown;
}

export type RawSchoolSearchKeywords = string | readonly string[];
export type RawSchoolLotteryData = Record<string, RawLotteryCounts | RawSchoolSearchKeywords>;
export type RawLotteryData = Record<string, RawSchoolLotteryData>;

export type LotteryDataIssueCode =
  | 'invalid-count-record'
  | 'missing-count'
  | 'non-numeric-count'
  | 'negative-count'
  | 'non-integer-count'
  | 'zero-denominator';

export interface LotteryDataIssue {
  readonly code: LotteryDataIssueCode;
  readonly field?: LotteryCountField;
  readonly message: string;
}

export interface LotteryRateRecord {
  readonly schoolName: string;
  readonly normalizedSchoolName: string;
  readonly ageGroup: string;
  readonly ageLabel: string;
  readonly schoolYear: string | null;
  readonly acceptedCount: number;
  readonly waitlistedCount: number;
  readonly totalCount: number;
  readonly estimatedLotteryRate: number | null;
  readonly estimatedLotteryRatePercent: number | null;
  readonly estimatedLotteryRateLabel: typeof ESTIMATED_LOTTERY_RATE_LABEL;
  readonly estimatedLotteryRateFormula: typeof ESTIMATED_LOTTERY_RATE_FORMULA;
  readonly announcedVacancyCount: number | null;
  readonly registrationCount: number | null;
  readonly priorityApplicantCount: number | null;
  readonly generalVacancyCount: number | null;
  readonly generalApplicantCount: number | null;
  readonly generalAcceptedCount: number | null;
  readonly generalWaitlistedCount: number | null;
  readonly generalLotteryRate: number | null;
  readonly generalLotteryRatePercent: number | null;
  readonly sequenceCounts: readonly LotterySequenceCount[];
  readonly sourceLabel: string | null;
  readonly note: string | null;
  readonly dataQualityIssues: readonly LotteryDataIssue[];
}

export interface LotterySequenceCount {
  readonly label: string;
  readonly count: number;
}

export interface LotterySequenceRate {
  readonly sequenceLabel: string;
  readonly sequenceApplicantCount: number;
  readonly cumulativeApplicantCountBefore: number;
  readonly remainingVacancyCount: number | null;
  readonly selectedAcceptedCount: number | null;
  readonly lotteryRate: number | null;
  readonly lotteryRatePercent: number | null;
}

export interface SchoolLotteryRates {
  readonly schoolName: string;
  readonly normalizedSchoolName: string;
  readonly searchKeywords: readonly string[];
  readonly districtNames: readonly string[];
  readonly normalizedSearchKeywords: readonly string[];
  readonly ageGroups: readonly LotteryRateRecord[];
}

export interface LotterySearchResult extends SchoolLotteryRates {
  readonly normalizedKeyword: string;
  readonly matchScore: number;
}
