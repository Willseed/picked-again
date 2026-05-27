import { parse, type HTMLElement, type Node as HtmlNode } from "node-html-parser";
import { DISTRICT_NAMES, DISTRICTS, SOURCES, TIMEZONE } from "./constants";
import { putLatestDataset } from "./kv";
import { parseKindergartenItems, type ParseContext } from "./parser";
import type {
  Env,
  KindergartenClassDataset,
  KindergartenDataset,
  KindergartenDistrictDataset,
  KindergartenSourceDataset,
  SourceConfig,
  SyncError,
  SyncResult,
} from "./types";

const MAX_CONCURRENT_REQUESTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;

const DEFAULT_CLASS_BY_SOURCE = {
  public: "3-5歲班",
  nonProfit: "5歲",
} as const;

type RequestLimiter = <T>(operation: () => Promise<T>) => Promise<T>;

interface ClassHtmlResult {
  html: string;
  sourceUrl: string;
}

interface FetchedHtml {
  html: string;
  sourceUrl: string;
  cookies: string[];
}

interface ClassSyncResult {
  dataset: KindergartenClassDataset;
  error: SyncError | null;
}

interface DistrictSyncResult {
  dataset: KindergartenDistrictDataset;
  errors: SyncError[];
}

interface SourceSyncResult {
  dataset: KindergartenSourceDataset;
  count: number;
  errors: SyncError[];
}

type FetchHtml = (url: string, init?: RequestInit) => Promise<FetchedHtml>;

function createRequestLimiter(maxConcurrent: number): RequestLimiter {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  function dispatch(): void {
    if (activeCount >= maxConcurrent) {
      return;
    }

    const next = queue.shift();
    if (!next) {
      return;
    }

    activeCount += 1;
    next();
  }

  return async function limit<T>(operation: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      queue.push(resolve);
      dispatch();
    });

    try {
      return await operation();
    } finally {
      activeCount -= 1;
      dispatch();
    }
  };
}

function isAsciiWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r" || character === "\f";
}

function hasCookiePairAfterComma(header: string, startIndex: number): boolean {
  let index = startIndex;

  while (index < header.length && isAsciiWhitespace(header[index])) {
    index += 1;
  }

  const nameStartIndex = index;
  while (index < header.length) {
    const character = header[index];

    if (character === "=") {
      return index > nameStartIndex;
    }

    if (character === ";" || character === ",") {
      return false;
    }

    index += 1;
  }

  return false;
}

function splitSetCookieHeader(header: string | null): string[] {
  if (!header) {
    return [];
  }

  const cookies: string[] = [];
  let cookieStartIndex = 0;

  for (let index = 0; index < header.length; index += 1) {
    if (header[index] === "," && hasCookiePairAfterComma(header, index + 1)) {
      const cookie = header.slice(cookieStartIndex, index).trim();
      if (cookie) {
        cookies.push(cookie);
      }
      cookieStartIndex = index + 1;
    }
  }

  const lastCookie = header.slice(cookieStartIndex).trim();
  if (lastCookie) {
    cookies.push(lastCookie);
  }

  return cookies;
}

function getResponseSetCookies(headers: Headers): string[] {
  const headersWithGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };

  return headersWithGetSetCookie.getSetCookie?.() ?? splitSetCookieHeader(headers.get("set-cookie"));
}

function toCookieHeader(setCookieHeaders: readonly string[]): string {
  const cookiesByName = new Map<string, string>();

  for (const setCookie of setCookieHeaders) {
    const cookie = setCookie.split(";", 1)[0]?.trim();

    if (!cookie) {
      continue;
    }

    const name = cookie.split("=", 1)[0];
    if (name) {
      cookiesByName.set(name, cookie);
    }
  }

  return Array.from(cookiesByName.values()).join("; ");
}

function withCookies(init: RequestInit, cookies: readonly string[]): RequestInit {
  const cookieHeader = toCookieHeader(cookies);

  if (!cookieHeader) {
    return init;
  }

  const headers = new Headers(init.headers);
  headers.set("cookie", cookieHeader);

  return {
    ...init,
    headers,
  };
}

function createFetchHtml(limit: RequestLimiter): FetchHtml {
  return async function fetchHtml(url: string, init: RequestInit = {}): Promise<FetchedHtml> {
    return limit(async () => {
      const controller = new AbortController();
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
      const headers = new Headers(init.headers);

      if (!headers.has("accept")) {
        headers.set("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
      }

      if (!headers.has("user-agent")) {
        headers.set("user-agent", "picked-again-kindergarten-sync/1.0");
      }

      try {
        const response = await fetch(url, {
          ...init,
          headers,
          redirect: "follow",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText} while fetching ${url}`);
        }

        return {
          html: await response.text(),
          sourceUrl: response.url || url,
          cookies: getResponseSetCookies(response.headers),
        };
      } catch (error: unknown) {
        if (timedOut) {
          throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1_000}s while fetching ${url}`);
        }

        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    });
  };
}

function buildBoardUrl(source: SourceConfig, districtCode: string): string {
  const url = new URL("/Board.aspx", source.baseUrl);
  url.searchParams.set("dist", districtCode);
  return url.toString();
}

function isHtmlElement(node: HtmlNode): node is HTMLElement {
  return typeof (node as { tagName?: unknown }).tagName === "string";
}

function getAttribute(element: HTMLElement, name: string): string | null {
  return element.getAttribute(name) ?? null;
}

function cleanText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200f\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeClassText(value: string): string {
  return cleanText(value)
    .replace(/臺/g, "台")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function classTextMatches(value: string, className: string): boolean {
  const normalizedValue = normalizeClassText(value);
  const normalizedClass = normalizeClassText(className);
  return normalizedValue === normalizedClass || normalizedValue.includes(normalizedClass);
}

function findClassLink(root: HTMLElement, pageUrl: string, className: string): string | null {
  for (const anchor of root.querySelectorAll("a")) {
    if (!classTextMatches(anchor.text, className)) {
      continue;
    }

    const href = getAttribute(anchor, "href")?.trim();

    if (!href || href.startsWith("#") || /^javascript:/iu.test(href)) {
      continue;
    }

    return new URL(href, pageUrl).toString();
  }

  return null;
}

function findInputById(root: HTMLElement, id: string): HTMLElement | null {
  return (
    root.querySelectorAll("input").find((input) => getAttribute(input, "id") === id) ?? null
  );
}

function findClassInput(root: HTMLElement, className: string): HTMLElement | null {
  for (const label of root.querySelectorAll("label")) {
    if (!classTextMatches(label.text, className)) {
      continue;
    }

    const labelFor = getAttribute(label, "for");
    if (labelFor) {
      const input = findInputById(root, labelFor);
      if (input) {
        return input;
      }
    }

    const nestedInput = label.querySelector("input");
    if (nestedInput) {
      return nestedInput;
    }
  }

  return root
    .querySelectorAll("input")
    .find((input) => classTextMatches(getAttribute(input, "value") ?? "", className)) ?? null;
}

function extractPostbackTarget(input: HTMLElement): string | null {
  const handlers = [getAttribute(input, "onclick"), getAttribute(input, "onchange")];

  for (const handler of handlers) {
    if (!handler) {
      continue;
    }

    const normalizedHandler = handler.replace(/\\'/g, "'").replace(/\\"/g, '"');
    const match = normalizedHandler.match(/__doPostBack\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]/u);

    if (match?.[1]) {
      return match[1];
    }
  }

  const inputName = getAttribute(input, "name");
  const inputId = getAttribute(input, "id");
  const suffix = inputId?.match(/_(\d+)$/u)?.[1];

  return inputName && suffix ? `${inputName}$${suffix}` : null;
}

function getInputValue(input: HTMLElement): string {
  return getAttribute(input, "value") ?? "";
}

function appendCheckedInput(body: URLSearchParams, input: HTMLElement, name: string): void {
  if (input.hasAttribute("checked")) {
    body.append(name, getInputValue(input));
  }
}

function appendPostbackInput(
  body: URLSearchParams,
  input: HTMLElement,
  classInputName: string | null,
): void {
  const name = getAttribute(input, "name");

  if (!name) {
    return;
  }

  const type = (getAttribute(input, "type") ?? "text").toLowerCase();

  if (type === "radio") {
    if (name !== classInputName) {
      appendCheckedInput(body, input, name);
    }

    return;
  }

  if (type === "checkbox") {
    appendCheckedInput(body, input, name);
    return;
  }

  if (type === "submit" || type === "button" || type === "image") {
    return;
  }

  body.append(name, getInputValue(input));
}

function buildPostbackBody(form: HTMLElement, classInput: HTMLElement, eventTarget: string): URLSearchParams {
  const body = new URLSearchParams();
  const classInputName = getAttribute(classInput, "name");

  for (const input of form.querySelectorAll("input")) {
    appendPostbackInput(body, input, classInputName);
  }

  if (classInputName) {
    body.set(classInputName, getInputValue(classInput));
  }

  body.set("__EVENTTARGET", eventTarget);
  body.set("__EVENTARGUMENT", "");

  if (!body.has("__LASTFOCUS")) {
    body.set("__LASTFOCUS", "");
  }

  return body;
}

function findPostbackRequest(
  root: HTMLElement,
  pageUrl: string,
  className: string,
): { url: string; body: URLSearchParams } | null {
  const form = root.querySelector("form");

  if (!form) {
    return null;
  }

  const classInput = findClassInput(root, className);

  if (!classInput) {
    return null;
  }

  const eventTarget = extractPostbackTarget(classInput);

  if (!eventTarget) {
    return null;
  }

  const action = getAttribute(form, "action") ?? pageUrl;
  const url = new URL(action, pageUrl).toString();
  const body = buildPostbackBody(form, classInput, eventTarget);

  if (!body.has("__VIEWSTATE") || !body.has("__VIEWSTATEGENERATOR") || !body.has("__EVENTVALIDATION")) {
    return null;
  }

  return { url, body };
}

function getSelectedClassName(root: HTMLElement): string | null {
  const hiddenClassName = root
    .querySelectorAll("input")
    .find((input) => {
      const id = getAttribute(input, "id") ?? "";
      const name = getAttribute(input, "name") ?? "";
      return id.toLowerCase().endsWith("classname") || name.toLowerCase().endsWith("classname");
    });

  const hiddenValue = hiddenClassName ? cleanText(getInputValue(hiddenClassName)) : "";
  if (hiddenValue) {
    return hiddenValue;
  }

  for (const heading of root.querySelectorAll("h1, h2, h3")) {
    const text = cleanText(heading.text);
    const openingBracketIndex = text.indexOf("【");
    if (openingBracketIndex < 0) {
      continue;
    }

    const closingBracketIndex = text.indexOf("】", openingBracketIndex + 1);
    if (closingBracketIndex > openingBracketIndex + 1) {
      return text.slice(openingBracketIndex + 1, closingBracketIndex);
    }
  }

  const checkedClassInput = root
    .querySelectorAll("input")
    .find(
      (input) =>
        (getAttribute(input, "name") ?? "").includes("classType") &&
        input.hasAttribute("checked"),
    );

  const checkedId = checkedClassInput ? getAttribute(checkedClassInput, "id") : null;
  if (checkedId) {
    const label = root
      .querySelectorAll("label")
      .find((candidate) => getAttribute(candidate, "for") === checkedId);

    if (label) {
      return cleanText(label.text);
    }
  }

  return null;
}

function assertSelectedClass(html: string, className: string): void {
  const selectedClassName = getSelectedClassName(parse(html));

  if (!selectedClassName) {
    throw new Error(`Class switch response did not identify selected class ${className}`);
  }

  if (
    normalizeClassText(selectedClassName) !== normalizeClassText(className)
  ) {
    throw new Error(`Class switch selected ${selectedClassName} instead of ${className}`);
  }
}

async function fetchSwitchedClassHtml(
  defaultPage: FetchedHtml,
  className: string,
  fetchHtml: FetchHtml,
): Promise<ClassHtmlResult> {
  const root = parse(defaultPage.html);
  const linkedUrl = findClassLink(root, defaultPage.sourceUrl, className);

  if (linkedUrl) {
    const linkedPage = await fetchHtml(linkedUrl, withCookies({}, defaultPage.cookies));
    assertSelectedClass(linkedPage.html, className);
    return {
      html: linkedPage.html,
      sourceUrl: linkedPage.sourceUrl,
    };
  }

  const postbackRequest = findPostbackRequest(root, defaultPage.sourceUrl, className);

  if (postbackRequest) {
    const page = await fetchHtml(
      postbackRequest.url,
      withCookies(
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            referer: defaultPage.sourceUrl,
          },
          body: postbackRequest.body,
        },
        defaultPage.cookies,
      ),
    );
    assertSelectedClass(page.html, className);
    return {
      html: page.html,
      sourceUrl: page.sourceUrl,
    };
  }

  throw new Error("Class switch not implemented yet");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildSyncError(
  source: SourceConfig,
  districtCode: string,
  className: string,
  message: string,
): SyncError {
  return {
    sourceType: source.type,
    districtCode,
    districtName: DISTRICT_NAMES[districtCode as keyof typeof DISTRICT_NAMES],
    className,
    message,
  };
}

function emptyClassDataset(className: string, sourceUrl: string): KindergartenClassDataset {
  return {
    className,
    fetchedAt: new Date().toISOString(),
    sourceUrl,
    items: [],
  };
}

async function syncClass(
  source: SourceConfig,
  districtCode: string,
  className: string,
  defaultPage: FetchedHtml,
  fetchHtml: FetchHtml,
): Promise<ClassSyncResult> {
  try {
    const htmlResult =
      className === DEFAULT_CLASS_BY_SOURCE[source.type]
        ? { html: defaultPage.html, sourceUrl: defaultPage.sourceUrl }
        : await fetchSwitchedClassHtml(defaultPage, className, fetchHtml);

    const context: ParseContext = {
      sourceType: source.type,
      districtCode,
      districtName: DISTRICT_NAMES[districtCode as keyof typeof DISTRICT_NAMES],
      className,
      sourceUrl: htmlResult.sourceUrl,
    };
    const items = parseKindergartenItems(htmlResult.html, context);

    return {
      dataset: {
        className,
        fetchedAt: new Date().toISOString(),
        sourceUrl: htmlResult.sourceUrl,
        items,
      },
      error: null,
    };
  } catch (error: unknown) {
    return {
      dataset: emptyClassDataset(className, defaultPage.sourceUrl),
      error: buildSyncError(source, districtCode, className, toErrorMessage(error)),
    };
  }
}

async function syncDistrict(
  source: SourceConfig,
  districtCode: string,
  fetchHtml: FetchHtml,
): Promise<DistrictSyncResult> {
  const defaultUrl = buildBoardUrl(source, districtCode);
  const districtName = DISTRICT_NAMES[districtCode as keyof typeof DISTRICT_NAMES];

  try {
    const defaultPage = await fetchHtml(defaultUrl);
    const classResults = await Promise.all(
      source.classes.map((className) =>
        syncClass(source, districtCode, className, defaultPage, fetchHtml),
      ),
    );

    return {
      dataset: {
        districtCode,
        districtName,
        classes: classResults.map((result) => result.dataset),
      },
      errors: classResults.flatMap((result) => (result.error ? [result.error] : [])),
    };
  } catch (error: unknown) {
    const errors = source.classes.map((className) =>
      buildSyncError(source, districtCode, className, toErrorMessage(error)),
    );

    return {
      dataset: {
        districtCode,
        districtName,
        classes: source.classes.map((className) => emptyClassDataset(className, defaultUrl)),
      },
      errors,
    };
  }
}

async function syncSource(
  source: SourceConfig,
  updatedAt: string,
  fetchHtml: FetchHtml,
): Promise<SourceSyncResult> {
  const districtResults = await Promise.all(
    DISTRICTS.map((districtCode) => syncDistrict(source, districtCode, fetchHtml)),
  );
  const dataset: KindergartenSourceDataset = {
    type: source.type,
    name: source.name,
    baseUrl: source.baseUrl,
    updatedAt,
    districts: districtResults.map((result) => result.dataset),
  };
  const count = dataset.districts.reduce(
    (sourceCount, district) =>
      sourceCount +
      district.classes.reduce(
        (districtCount, classDataset) => districtCount + classDataset.items.length,
        0,
      ),
    0,
  );

  return {
    dataset,
    count,
    errors: districtResults.flatMap((result) => result.errors),
  };
}

export async function syncAndStore(env: Env): Promise<SyncResult> {
  const updatedAt = new Date().toISOString();
  const fetchHtml = createFetchHtml(createRequestLimiter(MAX_CONCURRENT_REQUESTS));
  const sourceResults = await Promise.all(
    SOURCES.map((source) => syncSource(source, updatedAt, fetchHtml)),
  );
  const publicResult = sourceResults.find((result) => result.dataset.type === "public");
  const nonProfitResult = sourceResults.find((result) => result.dataset.type === "nonProfit");

  if (!publicResult || !nonProfitResult) {
    throw new Error("Kindergarten source configuration is incomplete");
  }

  const errors = sourceResults.flatMap((result) => result.errors);
  const totalCount = publicResult.count + nonProfitResult.count;

  if (totalCount === 0) {
    const failureSuffix =
      errors.length > 0 ? `; ${errors.length} class(es) failed` : "";
    throw new Error(`Kindergarten sync produced no items${failureSuffix}`);
  }

  const dataset: KindergartenDataset = {
    schemaVersion: 2,
    source: "cloudflare-worker",
    updatedAt,
    timezone: TIMEZONE,
    public: publicResult.dataset,
    nonProfit: nonProfitResult.dataset,
    errors,
  };

  await putLatestDataset(env, dataset);

  return {
    updatedAt,
    publicCount: publicResult.count,
    nonProfitCount: nonProfitResult.count,
    errors,
  };
}
