import {
  ESTIMATED_LOTTERY_RATE_FORMULA,
  ESTIMATED_LOTTERY_RATE_LABEL,
  SEARCH_KEYWORDS_FIELD,
  type LotteryCountField,
  type LotteryDataIssue,
  type LotteryRateRecord,
  type LotterySearchResult,
  type LotterySequenceCount,
  type LotterySequenceRate,
  type SchoolLotteryRates,
} from './lottery-data.model';

const ACCEPTED_FIELD: LotteryCountField = '正取';
const WAITLISTED_FIELD: LotteryCountField = '備取';
const PUBLIC_GENERAL_SEQUENCE_NUMBER = 8;
const NONPROFIT_GENERAL_SEQUENCE_NUMBER = 9;

interface CalculateSelectedSequenceLotteryRateOptions {
  readonly announcedVacancyCount: number | null;
  readonly sequenceCounts: readonly LotterySequenceCount[];
  readonly selectedSequenceLabel: string;
}

export function buildLotteryRateRecords(data: unknown): readonly LotteryRateRecord[] {
  if (!isRecord(data)) {
    return [];
  }

  return Object.entries(data).flatMap(([schoolName, ageGroups]) =>
    buildSchoolRecords(schoolName, ageGroups),
  );
}

export function buildSchoolLotteryRates(data: unknown): readonly SchoolLotteryRates[] {
  return groupLotteryRateRecords(buildLotteryRateRecords(data), buildSearchAliasesBySchool(data));
}

export function groupLotteryRateRecords(
  records: readonly LotteryRateRecord[],
  searchAliasesBySchool: ReadonlyMap<string, readonly string[]> = new Map(),
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
    .map(([schoolName, ageGroups]) => {
      const searchKeywords = searchAliasesBySchool.get(schoolName) ?? [];

      return {
        schoolName,
        normalizedSchoolName: normalizeSearchText(schoolName),
        searchKeywords,
        districtNames: extractDistrictNames(searchKeywords),
        normalizedSearchKeywords: buildNormalizedSearchKeywords(schoolName, searchKeywords),
        ageGroups: [...ageGroups].sort((left, right) =>
          compareAgeGroupLabels(left.ageGroup, right.ageGroup),
        ),
      };
    });
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
    .map((school, orderIndex) => ({
      school,
      orderIndex,
      matchScore: getBestFuzzyMatchScore(normalizedKeyword, school.normalizedSearchKeywords),
    }))
    .filter((match) => match.matchScore > 0)
    .sort(
      (left, right) => right.matchScore - left.matchScore || left.orderIndex - right.orderIndex,
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

export function getGeneralSequenceLabel(schoolName: string): string {
  const sequenceNumber = schoolName.includes('非營利')
    ? NONPROFIT_GENERAL_SEQUENCE_NUMBER
    : PUBLIC_GENERAL_SEQUENCE_NUMBER;

  return `順序${sequenceNumber}`;
}

export function isGeneralSequenceLabel(schoolName: string, sequenceLabel: string): boolean {
  return (
    normalizeSequenceLabel(sequenceLabel) ===
    normalizeSequenceLabel(getGeneralSequenceLabel(schoolName))
  );
}

export function hasLotterySequenceLabel(
  sequenceCounts: readonly LotterySequenceCount[],
  sequenceLabel: string,
): boolean {
  const normalizedSequenceLabel = normalizeSequenceLabel(sequenceLabel);

  return sequenceCounts.some(
    (sequence) => normalizeSequenceLabel(sequence.label) === normalizedSequenceLabel,
  );
}

export function findDefaultGeneralSequenceLabel(record: LotteryRateRecord): string | null {
  const generalSequenceLabel = getGeneralSequenceLabel(record.schoolName);

  return hasLotterySequenceLabel(record.sequenceCounts, generalSequenceLabel)
    ? generalSequenceLabel
    : null;
}

export function calculateSelectedSequenceLotteryRate(
  options: CalculateSelectedSequenceLotteryRateOptions,
): LotterySequenceRate | null {
  const selectedSequenceLabel = normalizeSequenceLabel(options.selectedSequenceLabel);
  let cumulativeApplicantCountBefore = 0;

  for (const sequence of options.sequenceCounts) {
    const sequenceApplicantCount = normalizeSequenceCount(sequence.count);

    if (normalizeSequenceLabel(sequence.label) === selectedSequenceLabel) {
      const vacancyCount = normalizeVacancyCount(options.announcedVacancyCount);

      if (vacancyCount === null) {
        return {
          sequenceLabel: sequence.label,
          sequenceApplicantCount,
          cumulativeApplicantCountBefore,
          remainingVacancyCount: null,
          selectedAcceptedCount: null,
          lotteryRate: null,
          lotteryRatePercent: null,
        };
      }

      const remainingVacancyCount = Math.max(vacancyCount - cumulativeApplicantCountBefore, 0);
      const selectedAcceptedCount = Math.min(sequenceApplicantCount, remainingVacancyCount);
      const lotteryRate =
        sequenceApplicantCount > 0 ? selectedAcceptedCount / sequenceApplicantCount : null;

      return {
        sequenceLabel: sequence.label,
        sequenceApplicantCount,
        cumulativeApplicantCountBefore,
        remainingVacancyCount,
        selectedAcceptedCount,
        lotteryRate,
        lotteryRatePercent: lotteryRate === null ? null : lotteryRate * 100,
      };
    }

    cumulativeApplicantCountBefore += sequenceApplicantCount;
  }

  return null;
}

function buildSchoolRecords(schoolName: string, ageGroups: unknown): readonly LotteryRateRecord[] {
  if (!isRecord(ageGroups)) {
    return [];
  }

  return Object.entries(ageGroups).flatMap(([ageGroup, counts]) =>
    ageGroup === SEARCH_KEYWORDS_FIELD
      ? []
      : [buildLotteryRateRecord(schoolName, ageGroup, counts)],
  );
}

function buildSearchAliasesBySchool(data: unknown): ReadonlyMap<string, readonly string[]> {
  const aliasesBySchool = new Map<string, readonly string[]>();

  if (!isRecord(data)) {
    return aliasesBySchool;
  }

  for (const [schoolName, ageGroups] of Object.entries(data)) {
    if (!isRecord(ageGroups)) {
      continue;
    }

    const searchAliases = readSearchAliases(ageGroups[SEARCH_KEYWORDS_FIELD]);

    if (searchAliases.length > 0) {
      aliasesBySchool.set(schoolName, searchAliases);
    }
  }

  return aliasesBySchool;
}

function readSearchAliases(value: unknown): readonly string[] {
  const rawAliases = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const aliases = rawAliases
    .filter((alias): alias is string => typeof alias === 'string')
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0);

  return Array.from(new Set(aliases));
}

function buildNormalizedSearchKeywords(
  schoolName: string,
  searchAliases: readonly string[],
): readonly string[] {
  const normalizedKeywords = [schoolName, ...searchAliases]
    .map((keyword) => normalizeSearchText(keyword))
    .filter((keyword) => keyword.length > 0);

  return Array.from(new Set(normalizedKeywords));
}

function extractDistrictNames(searchAliases: readonly string[]): readonly string[] {
  const districtNames = searchAliases
    .map(
      (alias) =>
        alias.match(/(?:臺北市|台北市)?(?<district>[^,\s，、]+區)$/u)?.groups?.['district'],
    )
    .filter((district): district is string => typeof district === 'string' && district.length > 0);

  return Array.from(new Set(districtNames));
}

function getBestFuzzyMatchScore(keyword: string, candidates: readonly string[]): number {
  return candidates.reduce(
    (bestScore, candidate) => Math.max(bestScore, getFuzzyMatchScore(keyword, candidate)),
    0,
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
      message: `${ageGroup} 不是含有正取/備取數字的資料，暫時無法估算。`,
    });
  }

  const acceptedCount = readCount(countsRecord, ACCEPTED_FIELD, dataQualityIssues);
  const waitlistedCount = readCount(countsRecord, WAITLISTED_FIELD, dataQualityIssues);
  const totalCount = acceptedCount + waitlistedCount;
  const estimatedLotteryRate = totalCount > 0 ? acceptedCount / totalCount : null;
  const identityRecord = readRecord(countsRecord['身份別']);
  const priorityIdentity = readRecord(identityRecord?.['優先順序']);
  const generalIdentity = readRecord(identityRecord?.['一般生']);
  const generalApplicantCount =
    readOptionalCount(generalIdentity, '申請') ?? readOptionalCount(countsRecord, '一般順序');
  const generalAcceptedCount = readOptionalCount(generalIdentity, ACCEPTED_FIELD);
  const generalWaitlistedCount =
    readOptionalCount(generalIdentity, WAITLISTED_FIELD) ?? waitlistedCount;
  const generalLotteryRate = deriveGeneralLotteryRate(
    generalApplicantCount,
    generalAcceptedCount,
    readOptionalFiniteNumber(generalIdentity, '中籤率') ??
      readOptionalFiniteNumber(countsRecord, '一般順序中籤率'),
  );
  const ageYearLabels = splitAgeYearLabel(ageGroup);

  if (totalCount === 0) {
    dataQualityIssues.push({
      code: 'zero-denominator',
      message: `${ageGroup} 沒有正取或備取資料，暫時無法估算中籤率。`,
    });
  }

  return {
    schoolName,
    normalizedSchoolName: normalizeSearchText(schoolName),
    ageGroup,
    ageLabel: ageYearLabels.ageLabel,
    schoolYear: ageYearLabels.schoolYear,
    acceptedCount,
    waitlistedCount,
    totalCount,
    estimatedLotteryRate,
    estimatedLotteryRatePercent: estimatedLotteryRate === null ? null : estimatedLotteryRate * 100,
    estimatedLotteryRateLabel: ESTIMATED_LOTTERY_RATE_LABEL,
    estimatedLotteryRateFormula: ESTIMATED_LOTTERY_RATE_FORMULA,
    announcedVacancyCount: readOptionalCount(countsRecord, '公告缺額'),
    registrationCount: readOptionalCount(countsRecord, '總登記人數'),
    priorityApplicantCount:
      readOptionalCount(priorityIdentity, '申請') ?? readOptionalCount(countsRecord, '優先順序'),
    generalVacancyCount:
      readOptionalCount(generalIdentity, '缺額') ?? readOptionalCount(countsRecord, '一般缺額'),
    generalApplicantCount,
    generalAcceptedCount,
    generalWaitlistedCount,
    generalLotteryRate,
    generalLotteryRatePercent: generalLotteryRate === null ? null : generalLotteryRate * 100,
    sequenceCounts: readSequenceCounts(countsRecord['各序位']),
    sourceLabel: readOptionalString(countsRecord, '資料來源'),
    note: readOptionalString(countsRecord, '備註'),
    dataQualityIssues,
  };
}

function splitAgeYearLabel(ageGroup: string): {
  readonly ageLabel: string;
  readonly schoolYear: string | null;
} {
  const normalizedAgeGroup = ageGroup.trim();
  const match = normalizedAgeGroup.match(/^(?<age>.+?)\s*[（(](?<year>[^）)]+)[）)]$/u);

  if (!match?.groups) {
    return { ageLabel: normalizedAgeGroup, schoolYear: null };
  }

  return {
    ageLabel: match.groups['age']?.trim() || normalizedAgeGroup,
    schoolYear: match.groups['year']?.trim() || null,
  };
}

function normalizeSequenceLabel(label: string): string {
  return label.normalize('NFKC').replace(/\s+/gu, '');
}

function normalizeSequenceCount(count: number): number {
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function normalizeVacancyCount(count: number | null): number | null {
  return count !== null && Number.isFinite(count) && count >= 0 ? count : null;
}

function readSequenceCounts(
  value: unknown,
): readonly { readonly label: string; readonly count: number }[] {
  const sequenceRecord = readRecord(value);

  if (!sequenceRecord) {
    return [];
  }

  return Object.entries(sequenceRecord)
    .map(([label]) => ({ label, count: readOptionalFiniteNumber(sequenceRecord, label) }))
    .filter(
      (entry): entry is { readonly label: string; readonly count: number } =>
        entry.count !== null && entry.count > 0,
    );
}

function deriveGeneralLotteryRate(
  applicantCount: number | null,
  acceptedCount: number | null,
  rawRate: number | null,
): number | null {
  if (applicantCount !== null && applicantCount > 0 && acceptedCount !== null) {
    return Math.min(1, acceptedCount / applicantCount);
  }

  if (rawRate !== null) {
    return Math.min(1, Math.max(0, rawRate));
  }

  return null;
}

function readOptionalCount(
  source: Record<string, unknown> | null | undefined,
  field: string,
): number | null {
  const value = readOptionalFiniteNumber(source, field);

  return value !== null && value >= 0 && Number.isInteger(value) ? value : null;
}

function readOptionalFiniteNumber(
  source: Record<string, unknown> | null | undefined,
  field: string,
): number | null {
  if (!source || !Object.hasOwn(source, field)) {
    return null;
  }

  const value = source[field];

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readOptionalString(source: Record<string, unknown>, field: string): string | null {
  const value = source[field];

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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
      message: `${field}人數不能是負數；請確認原始資料。`,
    });
    return 0;
  }

  if (!Number.isInteger(value)) {
    issues.push({
      code: 'non-integer-count',
      field,
      message: `${field}人數必須是整數；請確認是否為完整人數。`,
    });
    return 0;
  }

  return value;
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

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
