import {
  ESTIMATED_LOTTERY_RATE_FORMULA,
  ESTIMATED_LOTTERY_RATE_LABEL,
  type LotteryCountField,
  type LotteryDataIssue,
  type LotteryRateRecord,
  type LotterySearchResult,
  type SchoolLotteryRates,
} from './lottery-data.model';

const ACCEPTED_FIELD: LotteryCountField = '正取';
const WAITLISTED_FIELD: LotteryCountField = '備取';

export function buildLotteryRateRecords(data: unknown): readonly LotteryRateRecord[] {
  if (!isRecord(data)) {
    return [];
  }

  return Object.entries(data)
    .flatMap(([schoolName, ageGroups]) => buildSchoolRecords(schoolName, ageGroups))
    .sort(compareLotteryRateRecords);
}

export function buildSchoolLotteryRates(data: unknown): readonly SchoolLotteryRates[] {
  return groupLotteryRateRecords(buildLotteryRateRecords(data));
}

export function groupLotteryRateRecords(
  records: readonly LotteryRateRecord[],
): readonly SchoolLotteryRates[] {
  const schools = new Map<string, LotteryRateRecord[]>();

  for (const record of records) {
    const existingRecords = schools.get(record.schoolName);

    if (existingRecords) {
      existingRecords.push(record);
    } else {
      schools.set(record.schoolName, [record]);
    }
  }

  return Array.from(schools.entries())
    .map(([schoolName, ageGroups]) => ({
      schoolName,
      normalizedSchoolName: normalizeSearchText(schoolName),
      ageGroups: [...ageGroups].sort((left, right) =>
        compareAgeGroupLabels(left.ageGroup, right.ageGroup),
      ),
    }))
    .sort((left, right) => compareSchoolNames(left.schoolName, right.schoolName));
}

export function searchSchoolLotteryRates(
  schools: readonly SchoolLotteryRates[],
  keyword: string,
): readonly LotterySearchResult[] {
  const normalizedKeyword = normalizeSearchText(keyword);

  if (normalizedKeyword.length === 0) {
    return [];
  }

  return schools
    .map((school) => ({
      school,
      matchScore: getFuzzyMatchScore(normalizedKeyword, school.normalizedSchoolName),
    }))
    .filter((match) => match.matchScore > 0)
    .sort(
      (left, right) =>
        right.matchScore - left.matchScore ||
        compareSchoolNames(left.school.schoolName, right.school.schoolName),
    )
    .map(({ school, matchScore }) => ({
      ...school,
      normalizedKeyword,
      matchScore,
    }));
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-Hant')
    .replace(/臺/g, '台')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function getFuzzyMatchScore(keyword: string, candidate: string): number {
  const normalizedKeyword = normalizeSearchText(keyword);
  const normalizedCandidate = normalizeSearchText(candidate);

  if (normalizedKeyword.length === 0 || normalizedCandidate.length === 0) {
    return 0;
  }

  if (normalizedCandidate === normalizedKeyword) {
    return 1;
  }

  const substringIndex = normalizedCandidate.indexOf(normalizedKeyword);

  if (substringIndex >= 0) {
    const coverage = normalizedKeyword.length / normalizedCandidate.length;
    const prefixBonus = substringIndex === 0 ? 0.08 : 0;

    return Math.min(0.99, 0.78 + prefixBonus + coverage * 0.12);
  }

  if (isOrderedSubsequence(normalizedKeyword, normalizedCandidate)) {
    const coverage = normalizedKeyword.length / normalizedCandidate.length;

    return Math.min(0.77, 0.48 + coverage * 0.2);
  }

  return 0;
}

export function compareAgeGroupLabels(left: string, right: string): number {
  const leftAge = extractAge(left);
  const rightAge = extractAge(right);

  if (leftAge !== null && rightAge !== null && leftAge !== rightAge) {
    return rightAge - leftAge;
  }

  if (leftAge !== null && rightAge === null) {
    return -1;
  }

  if (leftAge === null && rightAge !== null) {
    return 1;
  }

  return left.localeCompare(right, 'zh-Hant');
}

function buildSchoolRecords(schoolName: string, ageGroups: unknown): readonly LotteryRateRecord[] {
  if (!isRecord(ageGroups)) {
    return [];
  }

  return Object.entries(ageGroups).map(([ageGroup, counts]) =>
    buildLotteryRateRecord(schoolName, ageGroup, counts),
  );
}

function buildLotteryRateRecord(
  schoolName: string,
  ageGroup: string,
  rawCounts: unknown,
): LotteryRateRecord {
  const dataQualityIssues: LotteryDataIssue[] = [];
  const countsRecord = isRecord(rawCounts) ? rawCounts : {};

  if (!isRecord(rawCounts)) {
    dataQualityIssues.push({
      code: 'invalid-count-record',
      message: `${ageGroup} 不是含有正取/備取數字的資料，焦慮儀表板看不懂這張籤。`,
    });
  }

  const acceptedCount = readCount(countsRecord, ACCEPTED_FIELD, dataQualityIssues);
  const waitlistedCount = readCount(countsRecord, WAITLISTED_FIELD, dataQualityIssues);
  const totalCount = acceptedCount + waitlistedCount;
  const estimatedLotteryRate = totalCount > 0 ? acceptedCount / totalCount : null;

  if (totalCount === 0) {
    dataQualityIssues.push({
      code: 'zero-denominator',
      message: `${ageGroup} 沒有正取或備取人數，無法估算中籤率；連分母都缺席。`,
    });
  }

  return {
    schoolName,
    normalizedSchoolName: normalizeSearchText(schoolName),
    ageGroup,
    acceptedCount,
    waitlistedCount,
    totalCount,
    estimatedLotteryRate,
    estimatedLotteryRatePercent:
      estimatedLotteryRate === null ? null : estimatedLotteryRate * 100,
    estimatedLotteryRateLabel: ESTIMATED_LOTTERY_RATE_LABEL,
    estimatedLotteryRateFormula: ESTIMATED_LOTTERY_RATE_FORMULA,
    dataQualityIssues,
  };
}

function readCount(
  source: Record<string, unknown>,
  field: LotteryCountField,
  issues: LotteryDataIssue[],
): number {
  if (!Object.hasOwn(source, field)) {
    issues.push({
      code: 'missing-count',
      field,
      message: `缺少${field}人數。`,
    });
    return 0;
  }

  const value = source[field];

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({
      code: 'non-numeric-count',
      field,
      message: `${field}人數不是有限數字。`,
    });
    return 0;
  }

  if (value < 0) {
    issues.push({
      code: 'negative-count',
      field,
      message: `${field}人數不能是負數；名額再少也不該倒扣。`,
    });
    return 0;
  }

  if (!Number.isInteger(value)) {
    issues.push({
      code: 'non-integer-count',
      field,
      message: `${field}人數必須是整數；半個名額只會讓家長群更焦慮。`,
    });
    return 0;
  }

  return value;
}

function compareLotteryRateRecords(left: LotteryRateRecord, right: LotteryRateRecord): number {
  return (
    compareSchoolNames(left.schoolName, right.schoolName) ||
    compareAgeGroupLabels(left.ageGroup, right.ageGroup)
  );
}

function compareSchoolNames(left: string, right: string): number {
  return left.localeCompare(right, 'zh-Hant');
}

function extractAge(label: string): number | null {
  const match = label.normalize('NFKC').match(/(\d+)\s*歲/u);

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

function isOrderedSubsequence(needle: string, haystack: string): boolean {
  let searchStart = 0;

  for (const character of Array.from(needle)) {
    const nextIndex = haystack.indexOf(character, searchStart);

    if (nextIndex === -1) {
      return false;
    }

    searchStart = nextIndex + character.length;
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
