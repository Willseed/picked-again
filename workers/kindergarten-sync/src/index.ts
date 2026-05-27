import { SERVICE_NAME } from "./constants";
import { getCorsHeaders, isAllowedRequest } from "./cors";
import { getHistoricalLotteryData, getLatestDataset } from "./kv";
import { syncAndStore } from "./sync";
import type { Env, KindergartenDataset, KindergartenItem, KindergartenSourceDataset } from "./types";

interface JsonResponseInit extends ResponseInit {
  headers?: HeadersInit;
}

type RawLotteryCounts = Record<string, string | number | null>;
type RawSchoolLotteryData = Record<string, RawLotteryCounts | string[]>;
type RawLotteryData = Record<string, RawSchoolLotteryData>;

const SEARCH_KEYWORDS_FIELD = "搜尋關鍵字";
const LIVE_SYNC_SCHOOL_YEAR = "115學年";

function jsonResponse(
  request: Request,
  env: Env,
  body: unknown,
  init: JsonResponseInit = {},
): Response {
  const headers = new Headers(getCorsHeaders(request, env));
  const initHeaders = new Headers(init.headers);

  initHeaders.forEach((value, key) => headers.set(key, value));
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function jsonError(
  request: Request,
  env: Env,
  error: string,
  status: number,
  headers?: HeadersInit,
): Response {
  return jsonResponse(
    request,
    env,
    { ok: false, error },
    {
      status,
      headers,
    },
  );
}

function handleOptions(request: Request, env: Env): Response {
  const origin = request.headers.get("Origin");

  if (!origin || !isAllowedRequest(request, env)) {
    return new Response(null, {
      status: 403,
      headers: getCorsHeaders(request, env),
    });
  }

  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request, env),
  });
}

function assertSyncAuthorized(request: Request, env: Env): Response | null {
  if (!env.SYNC_SECRET) {
    return jsonError(request, env, "SYNC_SECRET is not configured", 500);
  }

  const authHeader = request.headers.get("Authorization");
  const expected = `Bearer ${env.SYNC_SECRET}`;

  if (authHeader !== expected) {
    return jsonError(request, env, "Unauthorized", 401);
  }

  return null;
}

function methodNotAllowed(
  request: Request,
  env: Env,
  allowedMethod: "GET" | "POST",
): Response {
  return jsonError(request, env, "Method not allowed", 405, {
    allow: allowedMethod,
  });
}

type DatasetResult =
  | { dataset: KindergartenDataset; response: null }
  | { dataset: null; response: Response };

type HistoricalLotteryDataResult =
  | { data: unknown; response: null }
  | { data: null; response: Response };

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
    if (!isRecord(schoolData)) {
      continue;
    }

    clonedData[schoolName] = cloneSchoolLotteryData(schoolData);
  }

  return clonedData;
}

function normalizeLiveAgeLabel(className: string): string {
  const trimmedClassName = className.trim();

  return trimmedClassName.endsWith("班")
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

async function getRequiredDataset(
  request: Request,
  env: Env,
): Promise<DatasetResult> {
  const dataset = await getLatestDataset(env);

  if (!dataset) {
    return {
      dataset: null,
      response: jsonError(request, env, "Latest kindergarten dataset not found", 404),
    };
  }

  return {
    dataset,
    response: null,
  };
}

async function getRequiredHistoricalLotteryData(
  request: Request,
  env: Env,
): Promise<HistoricalLotteryDataResult> {
  const data = await getHistoricalLotteryData(env);

  if (!data) {
    return {
      data: null,
      response: jsonError(request, env, "Historical lottery data not found", 404),
    };
  }

  return {
    data,
    response: null,
  };
}

function healthResponse(request: Request, env: Env): Response {
  return jsonResponse(request, env, {
    ok: true,
    service: SERVICE_NAME,
    time: new Date().toISOString(),
  });
}

async function latestDatasetResponse(request: Request, env: Env): Promise<Response> {
  const { dataset, response } = await getRequiredDataset(request, env);
  if (response) {
    return response;
  }

  return jsonResponse(request, env, dataset, {
    headers: {
      "cache-control": "public, max-age=60",
    },
  });
}

async function lotteryDataResponse(request: Request, env: Env): Promise<Response> {
  const { data, response } = await getRequiredHistoricalLotteryData(request, env);
  if (response) {
    return response;
  }

  const latestDataset = await getLatestDataset(env);

  return jsonResponse(request, env, mergeLiveSyncData(data, latestDataset), {
    headers: {
      "cache-control": "public, max-age=60",
    },
  });
}

async function sourceDatasetResponse(
  request: Request,
  env: Env,
  sourceType: "public" | "nonProfit",
): Promise<Response> {
  const { dataset, response } = await getRequiredDataset(request, env);
  if (response) {
    return response;
  }

  return jsonResponse(request, env, dataset[sourceType]);
}

async function syncResponse(request: Request, env: Env): Promise<Response> {
  const unauthorized = assertSyncAuthorized(request, env);
  if (unauthorized) {
    return unauthorized;
  }

  const result = await syncAndStore(env);

  return jsonResponse(request, env, {
    ok: true,
    ...result,
  });
}

type RouteHandler = (request: Request, env: Env) => Promise<Response> | Response;

interface Route {
  readonly method: "GET" | "POST";
  readonly handler: RouteHandler;
}

const ROUTES: Readonly<Record<string, Route>> = {
  "/health": {
    method: "GET",
    handler: healthResponse,
  },
  "/kindergarten/latest": {
    method: "GET",
    handler: latestDatasetResponse,
  },
  "/kindergarten/lottery-data": {
    method: "GET",
    handler: lotteryDataResponse,
  },
  "/kindergarten/public": {
    method: "GET",
    handler: (request, env) => sourceDatasetResponse(request, env, "public"),
  },
  "/kindergarten/non-profit": {
    method: "GET",
    handler: (request, env) => sourceDatasetResponse(request, env, "nonProfit"),
  },
  "/kindergarten/sync": {
    method: "POST",
    handler: syncResponse,
  },
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    return handleOptions(request, env);
  }

  if (!isAllowedRequest(request, env)) {
    return jsonError(request, env, "Origin not allowed", 403);
  }

  const url = new URL(request.url);
  const route = ROUTES[url.pathname];

  if (route) {
    return request.method === route.method
      ? route.handler(request, env)
      : methodNotAllowed(request, env, route.method);
  }

  return jsonError(request, env, "Not found", 404);
}

const worker: ExportedHandler<Env> = {
  async fetch(request, env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Internal server error";
      return jsonError(request, env, message, 500);
    }
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      syncAndStore(env).catch((error: unknown) => {
        console.error("Scheduled kindergarten sync failed", error);
      }),
    );
  },
};

export default worker;
