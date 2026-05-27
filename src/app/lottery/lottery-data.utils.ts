import {
  ESTIMATED_LOTTERY_RATE_FORMULA,
  ESTIMATED_LOTTERY_RATE_LABEL,
  SEARCH_KEYWORDS_FIELD,
  type KindergartenClassDataset,
  type KindergartenDataset,
  type KindergartenDistrictDataset,
  type KindergartenItem,
  type KindergartenSourceDataset,
  type KindergartenSourceType,
  type LotteryCountField,
  type LotteryDataIssue,
  type LotteryRateRecord,
  type LotterySearchResult,
  type LotterySequenceCount,
  type LotterySequenceRate,
  type RawLotteryCounts,
  type RawLotteryData,
  type SchoolLotteryRates,
} from './lottery-data.model';

const ACCEPTED_FIELD: LotteryCountField = '正取';
const WAITLISTED_FIELD: LotteryCountField = '備取';
const LIVE_SYNC_SCHOOL_YEAR = '115學年';
const PUBLIC_GENERAL_SEQUENCE_NUMBER = 8;
const NONPROFIT_GENERAL_SEQUENCE_NUMBER = 9;

interface CalculateSelectedSequenceLotteryRateOptions {
  readonly announcedVacancyCount: number | null;
  readonly sequenceCounts: readonly LotterySequenceCount[];
  readonly selectedSequenceLabel: string;
}

export function buildLotteryRateRecords(data: unknown): readonly LotteryRateRecord[] {
  const rawData = coerceRawLotteryData(data);

  if (!isRecord(rawData)) {
    return [];
  }

  return Object.entries(rawData).flatMap(([schoolName, ageGroups]) =>
    buildSchoolRecords(schoolName, ageGroups),
  );
}

export function buildSchoolLotteryRates(data: unknown): readonly SchoolLotteryRates[] {
  const rawData = coerceRawLotteryData(data);

  return groupLotteryRateRecords(
    buildLotteryRateRecords(rawData),
    buildSearchAliasesBySchool(rawData),
  );
}

export function coerceRawLotteryData(data: unknown): unknown {
  return isKindergartenDataset(data) ? adaptKindergartenDatasetToRawLotteryData(data) : data;
}

export function adaptKindergartenDatasetToRawLotteryData(
  dataset: KindergartenDataset,
): RawLotteryData {
  const rawData: RawLotteryData = {};
  const searchAliasesBySchool = new Map<string, Set<string>>();

  for (const source of [dataset.public, dataset.nonProfit]) {
    for (const district of source.districts) {
      for (const classDataset of district.classes) {
        for (const item of classDataset.items) {
          addKindergartenItemToRawData(
            rawData,
            searchAliasesBySchool,
            source,
            district,
            classDataset,
            item,
          );
        }
      }
    }
  }

  for (const [schoolName, aliases] of searchAliasesBySchool.entries()) {
    if (aliases.size > 0) {
      rawData[schoolName][SEARCH_KEYWORDS_FIELD] = Array.from(aliases);
    }
  }

  return rawData;
}

function addKindergartenItemToRawData(
  rawData: RawLotteryData,
  searchAliasesBySchool: Map<string, Set<string>>,
  source: KindergartenSourceDataset,
  district: KindergartenDistrictDataset,
  classDataset: KindergartenClassDataset,
  item: KindergartenItem,
): void {
  const schoolName = item.schoolName.trim();
  const ageGroup = buildKindergartenAgeGroupLabel(item, classDataset);

  if (schoolName.length === 0 || ageGroup.length === 0) {
    return;
  }

  const schoolData = rawData[schoolName] ?? {};
  rawData[schoolName] = schoolData;
  schoolData[ageGroup] = buildKindergartenRawCounts(source, item);

  const aliases = getSearchAliasSet(searchAliasesBySchool, schoolName);
  addUniqueText(
    aliases,
    district.districtName,
    item.districtName,
    source.name,
    source.type,
    item.sourceType,
  );
}

function buildKindergartenAgeGroupLabel(
  item: KindergartenItem,
  classDataset: KindergartenClassDataset,
): string {
  const ageLabel = normalizeLiveAgeLabel(item.className || classDataset.className);

  if (ageLabel.length === 0 || ageLabel.includes('學年')) {
    return ageLabel;
  }

  return `${ageLabel}（${LIVE_SYNC_SCHOOL_YEAR}）`;
}

function normalizeLiveAgeLabel(className: string): string {
  const trimmedClassName = className.trim();

  return trimmedClassName.endsWith('班') && !trimmedClassName.endsWith('專班')
    ? trimmedClassName.slice(0, -1)
    : trimmedClassName;
}

function getSearchAliasSet(
  searchAliasesBySchool: Map<string, Set<string>>,
  schoolName: string,
): Set<string> {
  const existingAliases = searchAliasesBySchool.get(schoolName);

  if (existingAliases) {
    return existingAliases;
  }

  const aliases = new Set<string>();
  searchAliasesBySchool.set(schoolName, aliases);
  return aliases;
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

  return Array.from(schools.entries()).map(([schoolName, ageGroups]) => {
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
    .sort((left, right) => right.matchScore - left.matchScore || left.orderIndex - right.orderIndex)
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
    .replaceAll('臺', '台')
    .replaceAll(/[\s\p{P}\p{S}]+/gu, '');
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

function buildKindergartenRawCounts(
  source: KindergartenSourceDataset,
  item: KindergartenItem,
): RawLotteryCounts {
  const vacancyCount = pickKindergartenCount(item.availableQuota, item.totalQuota);
  const registeredCount = pickKindergartenCount(item.registeredCount);
  const sourceLabel = buildKindergartenSourceLabel(source, item);

  return {
    [ACCEPTED_FIELD]: pickKindergartenCount(item.availableQuota, item.totalQuota) ?? 0,
    [WAITLISTED_FIELD]: pickKindergartenCount(item.waitingCount, item.registeredCount) ?? 0,
    ...(vacancyCount === null ? {} : { 公告缺額: vacancyCount }),
    ...(registeredCount === null ? {} : { 總登記人數: registeredCount }),
    ...(sourceLabel === null ? {} : { 資料來源: sourceLabel }),
  } satisfies RawLotteryCounts;
}

function buildKindergartenSourceLabel(
  source: KindergartenSourceDataset,
  item: KindergartenItem,
): string | null {
  const parts = collectUniqueText([source.name, source.type, item.sourceType]);

  return parts.length > 0 ? parts.join(' / ') : null;
}

function pickKindergartenCount(...counts: readonly (number | null | undefined)[]): number | null {
  for (const count of counts) {
    if (count !== null && count !== undefined) {
      return count;
    }
  }

  return null;
}

function addUniqueText(target: Set<string>, ...values: readonly unknown[]): void {
  for (const value of collectUniqueText(values)) {
    target.add(value);
  }
}

function collectUniqueText(values: readonly unknown[]): readonly string[] {
  const uniqueValues = new Set<string>();

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const trimmedValue = value.trim();

    if (trimmedValue.length > 0) {
      uniqueValues.add(trimmedValue);
    }
  }

  return Array.from(uniqueValues);
}

function readSearchAliases(value: unknown): readonly string[] {
  let rawAliases: readonly unknown[] = [];

  if (Array.isArray(value)) {
    rawAliases = value;
  } else if (typeof value === 'string') {
    rawAliases = [value];
  }

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
    .map((alias) => extractDistrictName(alias))
    .filter((district): district is string => typeof district === 'string' && district.length > 0);

  return Array.from(new Set(districtNames));
}

function extractDistrictName(alias: string): string | null {
  let segmentStart = 0;

  for (let index = 0; index < alias.length; index += 1) {
    if (isDistrictAliasSeparator(alias[index] ?? '')) {
      segmentStart = index + 1;
    }
  }

  const segment = alias.slice(segmentStart);

  if (!segment.endsWith('區') || segment.length < 2) {
    return null;
  }

  for (const prefix of ['臺北市', '台北市']) {
    if (segment.startsWith(prefix)) {
      const district = segment.slice(prefix.length);

      return district.length >= 2 ? district : segment;
    }
  }

  return segment;
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
  const announcedVacancyCount = readOptionalCount(countsRecord, '公告缺額');
  const registrationCount = readOptionalCount(countsRecord, '總登記人數');
  const priorityApplicantCount =
    readOptionalCount(priorityIdentity, '申請') ?? readOptionalCount(countsRecord, '優先順序');
  const generalVacancyCount =
    readOptionalCount(generalIdentity, '缺額') ?? readOptionalCount(countsRecord, '一般缺額');
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
  const priorityAcceptedCount = derivePriorityAcceptedCount(
    announcedVacancyCount,
    generalVacancyCount,
    priorityApplicantCount,
  );
  const priorityLotteryRate = derivePriorityLotteryRate(
    priorityApplicantCount,
    priorityAcceptedCount,
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
    announcedVacancyCount,
    registrationCount,
    priorityApplicantCount,
    priorityAcceptedCount,
    priorityLotteryRate,
    priorityLotteryRatePercent: priorityLotteryRate === null ? null : priorityLotteryRate * 100,
    generalVacancyCount,
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

  if (!endsWithClosingParenthesis(normalizedAgeGroup)) {
    return { ageLabel: normalizedAgeGroup, schoolYear: null };
  }

  const body = normalizedAgeGroup.slice(0, -1);
  const lastClosingParenthesisIndex = findLastClosingParenthesisIndex(body);
  const openingParenthesisIndex = findFirstOpeningParenthesisIndex(
    body,
    lastClosingParenthesisIndex + 1,
  );

  if (openingParenthesisIndex <= 0) {
    return { ageLabel: normalizedAgeGroup, schoolYear: null };
  }

  const year = body.slice(openingParenthesisIndex + 1);

  if (year.length === 0) {
    return { ageLabel: normalizedAgeGroup, schoolYear: null };
  }

  return {
    ageLabel: body.slice(0, openingParenthesisIndex).trim() || normalizedAgeGroup,
    schoolYear: year.trim() || null,
  };
}

function normalizeSequenceLabel(label: string): string {
  return label.normalize('NFKC').replaceAll(/\s+/gu, '');
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

function derivePriorityAcceptedCount(
  announcedVacancyCount: number | null,
  generalVacancyCount: number | null,
  applicantCount: number | null,
): number | null {
  if (announcedVacancyCount === null || generalVacancyCount === null) {
    return null;
  }

  const priorityVacancyCount = Math.max(announcedVacancyCount - generalVacancyCount, 0);

  return applicantCount === null
    ? priorityVacancyCount
    : Math.min(applicantCount, priorityVacancyCount);
}

function derivePriorityLotteryRate(
  applicantCount: number | null,
  acceptedCount: number | null,
): number | null {
  if (applicantCount === null || applicantCount <= 0 || acceptedCount === null) {
    return null;
  }

  return Math.min(1, Math.max(0, acceptedCount / applicantCount));
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
  const normalizedLabel = label.normalize('NFKC');

  for (let index = 0; index < normalizedLabel.length; index += 1) {
    const character = normalizedLabel[index] ?? '';

    if (!isAsciiDigit(character)) {
      continue;
    }

    const digitStartIndex = index;
    const digitEndIndex = findDigitEndIndex(normalizedLabel, digitStartIndex);
    const ageMarkerIndex = findFirstNonWhitespaceIndex(normalizedLabel, digitEndIndex);

    if (normalizedLabel[ageMarkerIndex] === '歲') {
      return Number(normalizedLabel.slice(digitStartIndex, digitEndIndex));
    }
  }

  return null;
}

function findDigitEndIndex(value: string, startIndex: number): number {
  for (let index = startIndex; index < value.length; index += 1) {
    if (!isAsciiDigit(value[index] ?? '')) {
      return index;
    }
  }

  return value.length;
}

function findFirstNonWhitespaceIndex(value: string, startIndex: number): number {
  for (let index = startIndex; index < value.length; index += 1) {
    if (!isWhitespace(value[index] ?? '')) {
      return index;
    }
  }

  return value.length;
}

function isDistrictAliasSeparator(character: string): boolean {
  return character === ',' || character === '，' || character === '、' || isWhitespace(character);
}

function endsWithClosingParenthesis(value: string): boolean {
  const lastCharacter = value[value.length - 1];

  return lastCharacter === ')' || lastCharacter === '）';
}

function findLastClosingParenthesisIndex(value: string): number {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const character = value[index];

    if (character === ')' || character === '）') {
      return index;
    }
  }

  return -1;
}

function findFirstOpeningParenthesisIndex(value: string, startIndex: number): number {
  for (let index = Math.max(startIndex, 0); index < value.length; index += 1) {
    const character = value[index];

    if (character === '(' || character === '（') {
      return index;
    }
  }

  return -1;
}

function isAsciiDigit(character: string): boolean {
  const codePoint = character.codePointAt(0);

  return codePoint !== undefined && codePoint >= 48 && codePoint <= 57;
}

function isWhitespace(character: string): boolean {
  return character.trim().length === 0;
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

function isKindergartenDataset(value: unknown): value is KindergartenDataset {
  const dataset = readRecord(value);

  return (
    dataset !== null &&
    dataset['schemaVersion'] === 2 &&
    dataset['source'] === 'cloudflare-worker' &&
    typeof dataset['updatedAt'] === 'string' &&
    dataset['timezone'] === 'Asia/Taipei' &&
    isKindergartenSourceDataset(dataset['public']) &&
    isKindergartenSourceDataset(dataset['nonProfit'])
  );
}

function isKindergartenSourceDataset(value: unknown): value is KindergartenSourceDataset {
  const source = readRecord(value);
  const districts = source?.['districts'];

  return (
    source !== null &&
    isKindergartenSourceType(source['type']) &&
    typeof source['name'] === 'string' &&
    typeof source['baseUrl'] === 'string' &&
    typeof source['updatedAt'] === 'string' &&
    Array.isArray(districts) &&
    districts.every(isKindergartenDistrictDataset)
  );
}

function isKindergartenDistrictDataset(value: unknown): value is KindergartenDistrictDataset {
  const district = readRecord(value);
  const classes = district?.['classes'];

  return (
    district !== null &&
    typeof district['districtCode'] === 'string' &&
    typeof district['districtName'] === 'string' &&
    Array.isArray(classes) &&
    classes.every(isKindergartenClassDataset)
  );
}

function isKindergartenClassDataset(value: unknown): value is KindergartenClassDataset {
  const classDataset = readRecord(value);
  const items = classDataset?.['items'];

  return (
    classDataset !== null &&
    typeof classDataset['className'] === 'string' &&
    typeof classDataset['fetchedAt'] === 'string' &&
    typeof classDataset['sourceUrl'] === 'string' &&
    Array.isArray(items) &&
    items.every(isKindergartenItem)
  );
}

function isKindergartenItem(value: unknown): value is KindergartenItem {
  const item = readRecord(value);

  return (
    item !== null &&
    typeof item['id'] === 'string' &&
    typeof item['schoolName'] === 'string' &&
    typeof item['districtCode'] === 'string' &&
    typeof item['districtName'] === 'string' &&
    isKindergartenSourceType(item['sourceType']) &&
    typeof item['className'] === 'string' &&
    isOptionalKindergartenCount(item['totalQuota']) &&
    isOptionalKindergartenCount(item['availableQuota']) &&
    isOptionalKindergartenCount(item['registeredCount']) &&
    isOptionalKindergartenCount(item['waitingCount']) &&
    isOptionalStringOrNull(item['address']) &&
    isOptionalStringOrNull(item['phone']) &&
    isOptionalKindergartenRawRecord(item['raw'])
  );
}

function isKindergartenSourceType(value: unknown): value is KindergartenSourceType {
  return value === 'public' || value === 'nonProfit';
}

function isOptionalKindergartenCount(value: unknown): value is number | null | undefined {
  return (
    value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value))
  );
}

function isOptionalStringOrNull(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function isOptionalKindergartenRawRecord(
  value: unknown,
): value is Readonly<Record<string, string | number | null>> | undefined {
  if (value === undefined) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(
    (entry) => typeof entry === 'string' || typeof entry === 'number' || entry === null,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
