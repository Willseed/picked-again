import type { KindergartenDataset, KindergartenItem, KindergartenSourceDataset } from "./types";

export type RawLotteryCounts = Record<string, string | number | null>;
export type RawSchoolLotteryData = Record<string, RawLotteryCounts | string[]>;
export type RawLotteryData = Record<string, RawSchoolLotteryData>;

const SEARCH_KEYWORDS_FIELD = "搜尋關鍵字";
const LIVE_SYNC_SCHOOL_YEAR = "115學年";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-Hant")
    .replace(/臺/g, "台")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
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

function buildLiveRawCounts(
  source: KindergartenSourceDataset,
  item: KindergartenItem,
): RawLotteryCounts {
  const vacancyCount = pickCount(item.availableQuota, item.totalQuota);
  const registeredCount = pickCount(item.registeredCount);

  return {
    正取: pickCount(item.availableQuota, item.totalQuota) ?? 0,
    備取: pickCount(item.waitingCount, item.registeredCount) ?? 0,
    ...(vacancyCount === null ? {} : { 公告缺額: vacancyCount }),
    ...(registeredCount === null ? {} : { 總登記人數: registeredCount }),
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
