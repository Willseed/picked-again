import type { KindergartenDataset, KindergartenItem, KindergartenSourceDataset } from "./types";

export type RawLotteryCounts = Record<string, unknown>;
export type RawSchoolLotteryData = Record<string, RawLotteryCounts | string[]>;
export type RawLotteryData = Record<string, RawSchoolLotteryData>;

const SEARCH_KEYWORDS_FIELD = "搜尋關鍵字";
const LIVE_SYNC_SCHOOL_YEAR = "115學年";
const SEQUENCE_FIELD_PREFIX = "順序";
const GENERAL_SEQUENCE_BY_SOURCE = {
  nonProfit: "順序9",
} as const;
const PUBLIC_MIXED_AGE_GENERAL_SEQUENCE = "順序15";
const PUBLIC_TODDLER_GENERAL_SEQUENCE = "順序8";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-Hant")
    .replaceAll("臺", "台")
    .replaceAll(/[\s\p{P}\p{S}]+/gu, "");
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function cloneSchoolLotteryEntry(
  key: string,
  value: unknown,
): RawLotteryCounts | string[] | null {
  if (key === SEARCH_KEYWORDS_FIELD) {
    return readStringArray(value);
  }

  return isRecord(value) ? { ...value } as RawLotteryCounts : null;
}

function cloneSchoolLotteryData(schoolData: Record<string, unknown>): RawSchoolLotteryData {
  const clonedSchoolData: RawSchoolLotteryData = {};

  for (const [key, value] of Object.entries(schoolData)) {
    const clonedEntry = cloneSchoolLotteryEntry(key, value);

    if (clonedEntry !== null) {
      clonedSchoolData[key] = clonedEntry;
    }
  }

  return clonedSchoolData;
}

function cloneHistoricalLotteryData(data: unknown): RawLotteryData {
  if (!isRecord(data)) {
    return {};
  }

  const clonedData: RawLotteryData = {};

  for (const [schoolName, schoolData] of Object.entries(data)) {
    if (isRecord(schoolData)) {
      clonedData[schoolName] = cloneSchoolLotteryData(schoolData);
    }
  }

  return clonedData;
}

function normalizeLiveAgeLabel(className: string): string {
  const trimmedClassName = className.trim();

  return trimmedClassName.endsWith("班") && !trimmedClassName.endsWith("專班")
    ? trimmedClassName.slice(0, -1)
    : trimmedClassName;
}

function pickCount(...counts: readonly (number | null | undefined)[]): number | null {
  for (const count of counts) {
    if (count !== null && count !== undefined) {
      return count;
    }
  }

  return null;
}

function readRawNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  const normalizedValue = value
    .normalize("NFKC")
    .replaceAll(/[,，]/g, "")
    .replaceAll(/\s+/g, "");
  const match = normalizedValue.match(/\d+(?:\.\d+)?/u);

  if (!match) {
    return null;
  }

  const numericValue = Number(match[0]);

  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : null;
}

function collectKeywords(...values: readonly unknown[]): readonly string[] {
  const keywords = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const keyword = value.trim();
    if (keyword.length > 0) {
      keywords.add(keyword);
    }
  }

  return Array.from(keywords);
}

function appendSearchKeywords(
  schoolData: RawSchoolLotteryData,
  keywords: readonly string[],
): void {
  const existingKeywords = schoolData[SEARCH_KEYWORDS_FIELD];
  const mergedKeywords = new Set(
    Array.isArray(existingKeywords) ? existingKeywords : [],
  );

  for (const keyword of keywords) {
    mergedKeywords.add(keyword);
  }

  if (mergedKeywords.size > 0) {
    schoolData[SEARCH_KEYWORDS_FIELD] = Array.from(mergedKeywords);
  }
}

function buildSequenceCounts(item: KindergartenItem): Record<string, number> {
  const sequenceCounts: Record<string, number> = {};

  for (const [field, value] of Object.entries(item.raw ?? {})) {
    const fieldName = field.trim();

    if (!fieldName.startsWith(SEQUENCE_FIELD_PREFIX)) {
      continue;
    }

    const sequenceCount = readRawNumber(value);

    if (sequenceCount !== null) {
      sequenceCounts[fieldName] = sequenceCount;
    }
  }

  return sequenceCounts;
}

function sumPrioritySequenceCounts(
  sequenceCounts: Readonly<Record<string, number>>,
  generalSequenceLabel: string | null,
): number {
  return Object.entries(sequenceCounts).reduce(
    (total, [label, count]) => total + (label === generalSequenceLabel ? 0 : count),
    0,
  );
}

function getGeneralSequenceLabel(source: KindergartenSourceDataset, className: string): string | null {
  if (source.type === "nonProfit") {
    return GENERAL_SEQUENCE_BY_SOURCE.nonProfit;
  }

  const ageLabel = normalizeLiveAgeLabel(className);

  return ageLabel.includes("2歲")
    ? PUBLIC_TODDLER_GENERAL_SEQUENCE
    : PUBLIC_MIXED_AGE_GENERAL_SEQUENCE;
}

function getGeneralVacancyCount(
  vacancyCount: number | null,
  priorityApplicantCount: number,
): number | null {
  return vacancyCount === null ? null : Math.max(vacancyCount - priorityApplicantCount, 0);
}

function getAcceptedCount(
  fallbackAcceptedCount: number,
  generalVacancyCount: number | null,
  generalApplicantCount: number | null,
): number {
  return generalVacancyCount === null || generalApplicantCount === null
    ? fallbackAcceptedCount
    : Math.min(generalVacancyCount, generalApplicantCount);
}

function getWaitlistedCount(
  fallbackWaitlistedCount: number,
  generalVacancyCount: number | null,
  generalApplicantCount: number | null,
): number {
  return generalVacancyCount === null || generalApplicantCount === null
    ? fallbackWaitlistedCount
    : Math.max(generalApplicantCount - generalVacancyCount, 0);
}

function getLotteryRate(acceptedCount: number, applicantCount: number | null): number | null {
  return applicantCount !== null && applicantCount > 0
    ? Math.min(1, Math.max(0, acceptedCount / applicantCount))
    : null;
}

function buildLiveRawCounts(
  source: KindergartenSourceDataset,
  item: KindergartenItem,
): RawLotteryCounts {
  const vacancyCount = pickCount(item.availableQuota, item.totalQuota);
  const registeredCount = pickCount(item.registeredCount);
  const sequenceCounts = buildSequenceCounts(item);
  const hasSequenceCounts = Object.keys(sequenceCounts).length > 0;
  const generalSequenceLabel = getGeneralSequenceLabel(source, item.className);
  const generalApplicantCount =
    generalSequenceLabel === null ? null : sequenceCounts[generalSequenceLabel] ?? null;
  const priorityApplicantCount = sumPrioritySequenceCounts(sequenceCounts, generalSequenceLabel);
  const generalVacancyCount = getGeneralVacancyCount(vacancyCount, priorityApplicantCount);
  const fallbackAcceptedCount = pickCount(item.availableQuota, item.totalQuota) ?? 0;
  const fallbackWaitlistedCount = pickCount(item.waitingCount, item.registeredCount) ?? 0;
  const acceptedCount = hasSequenceCounts
    ? getAcceptedCount(fallbackAcceptedCount, generalVacancyCount, generalApplicantCount)
    : fallbackAcceptedCount;
  const waitlistedCount = hasSequenceCounts
    ? getWaitlistedCount(fallbackWaitlistedCount, generalVacancyCount, generalApplicantCount)
    : fallbackWaitlistedCount;
  const generalLotteryRate = getLotteryRate(acceptedCount, generalApplicantCount);

  return {
    正取: acceptedCount,
    備取: waitlistedCount,
    ...(vacancyCount === null ? {} : { 公告缺額: vacancyCount }),
    ...(registeredCount === null ? {} : { 總登記人數: registeredCount }),
    ...(hasSequenceCounts ? { 各序位: sequenceCounts } : {}),
    ...(hasSequenceCounts ? { 優先順序: priorityApplicantCount } : {}),
    ...(generalVacancyCount === null ? {} : { 一般缺額: generalVacancyCount }),
    ...(generalApplicantCount === null ? {} : { 一般順序: generalApplicantCount }),
    ...(hasSequenceCounts
      ? {
          身份別: {
            優先順序: { 申請: priorityApplicantCount },
            一般生: {
              缺額: generalVacancyCount,
              申請: generalApplicantCount,
              正取: acceptedCount,
              備取: waitlistedCount,
              中籤率: generalLotteryRate,
            },
          },
        }
      : {}),
    資料來源: `${source.name} / ${source.type}`,
  };
}

function buildCanonicalSchoolLookup(data: RawLotteryData): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();

  for (const [schoolName, schoolData] of Object.entries(data)) {
    for (const keyword of [schoolName, ...readStringArray(schoolData[SEARCH_KEYWORDS_FIELD])]) {
      const normalizedKeyword = normalizeSearchText(keyword);

      if (normalizedKeyword.length > 0 && !lookup.has(normalizedKeyword)) {
        lookup.set(normalizedKeyword, schoolName);
      }
    }
  }

  return lookup;
}

function resolveCanonicalSchoolName(
  schoolName: string,
  canonicalSchoolLookup: ReadonlyMap<string, string>,
): string {
  return canonicalSchoolLookup.get(normalizeSearchText(schoolName)) ?? schoolName;
}

function getLiveItemClassName(
  item: KindergartenItem,
  classDatasetClassName: string,
): string {
  return (item.className || classDatasetClassName).trim();
}

function mergeLiveItem(
  mergedData: RawLotteryData,
  canonicalSchoolLookup: ReadonlyMap<string, string>,
  source: KindergartenSourceDataset,
  districtName: string,
  className: string,
  item: KindergartenItem,
): void {
  const rawSchoolName = item.schoolName.trim();
  const rawClassName = getLiveItemClassName(item, className);

  if (rawSchoolName.length === 0 || rawClassName.length === 0) {
    return;
  }

  const schoolName = resolveCanonicalSchoolName(rawSchoolName, canonicalSchoolLookup);
  const schoolData = mergedData[schoolName] ?? {};
  mergedData[schoolName] = schoolData;

  const ageLabel = normalizeLiveAgeLabel(rawClassName);
  schoolData[`${ageLabel}（${LIVE_SYNC_SCHOOL_YEAR}）`] = buildLiveRawCounts(
    source,
    item,
  );
  appendSearchKeywords(
    schoolData,
    collectKeywords(rawSchoolName, districtName, item.districtName, source.name, source.type),
  );
}

export function mergeLiveSyncData(
  historicalData: unknown,
  latestDataset: KindergartenDataset | null,
): RawLotteryData {
  const mergedData = cloneHistoricalLotteryData(historicalData);
  const canonicalSchoolLookup = buildCanonicalSchoolLookup(mergedData);

  if (!latestDataset) {
    return mergedData;
  }

  for (const source of [latestDataset.public, latestDataset.nonProfit]) {
    for (const district of source.districts) {
      for (const classDataset of district.classes) {
        for (const item of classDataset.items) {
          mergeLiveItem(
            mergedData,
            canonicalSchoolLookup,
            source,
            district.districtName,
            classDataset.className,
            item,
          );
        }
      }
    }
  }

  return mergedData;
}

export function buildLatestRawLotteryData(
  latestDataset: KindergartenDataset,
  historicalData: unknown,
): RawLotteryData {
  const historicalLookupSource = cloneHistoricalLotteryData(historicalData);
  const canonicalSchoolLookup = buildCanonicalSchoolLookup(historicalLookupSource);
  const latestData: RawLotteryData = {};

  for (const source of [latestDataset.public, latestDataset.nonProfit]) {
    for (const district of source.districts) {
      for (const classDataset of district.classes) {
        for (const item of classDataset.items) {
          mergeLiveItem(
            latestData,
            canonicalSchoolLookup,
            source,
            district.districtName,
            classDataset.className,
            item,
          );
        }
      }
    }
  }

  return latestData;
}
