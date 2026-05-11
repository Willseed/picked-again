export const LOTTERY_DATA_URL = '/assets/data.json';

export const ESTIMATED_LOTTERY_RATE_LABEL = '估算中籤率（給心臟先打預防針）';
export const ESTIMATED_LOTTERY_RATE_FORMULA = '正取 ÷ (正取 + 備取)';
export const SEARCH_KEYWORDS_FIELD = '搜尋關鍵字';

export type LotteryCountField = '正取' | '備取';

export interface RawLotteryCounts {
  readonly 正取?: unknown;
  readonly 備取?: unknown;
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
  readonly acceptedCount: number;
  readonly waitlistedCount: number;
  readonly totalCount: number;
  readonly estimatedLotteryRate: number | null;
  readonly estimatedLotteryRatePercent: number | null;
  readonly estimatedLotteryRateLabel: typeof ESTIMATED_LOTTERY_RATE_LABEL;
  readonly estimatedLotteryRateFormula: typeof ESTIMATED_LOTTERY_RATE_FORMULA;
  readonly dataQualityIssues: readonly LotteryDataIssue[];
}

export interface SchoolLotteryRates {
  readonly schoolName: string;
  readonly normalizedSchoolName: string;
  readonly searchKeywords: readonly string[];
  readonly normalizedSearchKeywords: readonly string[];
  readonly ageGroups: readonly LotteryRateRecord[];
}

export interface LotterySearchResult extends SchoolLotteryRates {
  readonly normalizedKeyword: string;
  readonly matchScore: number;
}
