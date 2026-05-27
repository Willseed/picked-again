import { parse, type HTMLElement, type Node as HtmlNode } from "node-html-parser";
import type { KindergartenItem, SourceType } from "./types";

export interface ParseContext {
  sourceType: SourceType;
  districtCode: string;
  districtName: string;
  className: string;
  sourceUrl: string;
}

export function buildKindergartenItemId(context: ParseContext, schoolName: string): string {
  return [
    context.sourceType,
    context.districtCode,
    context.className,
    schoolName,
  ].join(":");
}

type RawRowValue = string | number | null;
type RawRow = Record<string, RawRowValue>;

type NormalizedField =
  | "schoolName"
  | "totalQuota"
  | "availableQuota"
  | "registeredCount"
  | "waitingCount"
  | "address"
  | "phone";

const FIELD_ALIASES = {
  schoolName: ["園所名稱", "幼兒園名稱", "學校名稱", "園名", "名稱", "幼兒園", "學校", "校名"],
  totalQuota: ["招生名額", "核定名額"],
  availableQuota: ["可招收名額", "缺額", "尚可招生名額", "可招生名額", "公告缺額"],
  registeredCount: ["登記人數", "報名人數", "報名數", "總登記人數"],
  waitingCount: ["備取人數", "備取數"],
  address: ["地址"],
  phone: ["電話", "聯絡電話"],
} as const satisfies Record<NormalizedField, readonly string[]>;

const CONTAINS_ALIASES = {
  schoolName: ["園所名稱", "幼兒園名稱", "學校名稱", "幼兒園", "學校", "園名", "校名"],
  totalQuota: ["招生名額", "核定名額"],
  availableQuota: ["可招收名額", "尚可招生名額", "可招生名額", "公告缺額", "缺額"],
  registeredCount: ["總登記人數", "登記人數", "報名人數", "報名數"],
  waitingCount: ["備取人數", "備取數"],
  address: ["地址"],
  phone: ["聯絡電話", "電話"],
} as const satisfies Record<NormalizedField, readonly string[]>;

function isHtmlElement(node: HtmlNode): node is HTMLElement {
  return typeof (node as { tagName?: unknown }).tagName === "string";
}

function cleanText(value: string): string {
  return value
    .normalize("NFKC")
    .replaceAll("\u00a0", " ")
    .replaceAll(/[\u200b-\u200f\uFEFF]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function normalizeHeader(value: string): string {
  return cleanText(value)
    .toLocaleLowerCase("zh-Hant")
    .replaceAll("臺", "台")
    .replaceAll(/[\s\p{P}\p{S}]+/gu, "");
}

function getDirectCells(row: HTMLElement): HTMLElement[] {
  return row.childNodes.filter(isHtmlElement).filter((node) => {
    const tagName = node.tagName.toLowerCase();
    return tagName === "th" || tagName === "td";
  });
}

function extractCellText(cell: HTMLElement): string {
  return cleanText(cell.text);
}

function makeUniqueHeaders(headers: readonly string[]): string[] {
  const seen = new Map<string, number>();

  return headers.map((header, index) => {
    const baseHeader = header.length > 0 ? header : `column${index + 1}`;
    const seenCount = seen.get(baseHeader) ?? 0;
    seen.set(baseHeader, seenCount + 1);

    return seenCount === 0 ? baseHeader : `${baseHeader}_${seenCount + 1}`;
  });
}

function getHeaderRow(table: HTMLElement): HTMLElement | null {
  const theadRows = table.querySelector("thead")?.querySelectorAll("tr") ?? [];
  const theadHeader = theadRows.find((row) =>
    getDirectCells(row).some((cell) => extractCellText(cell).length > 0),
  );

  if (theadHeader) {
    return theadHeader;
  }

  return (
    table
      .querySelectorAll("tr")
      .find((row) => getDirectCells(row).some((cell) => extractCellText(cell).length > 0)) ??
    null
  );
}

function rowToRawRecord(headers: readonly string[], row: HTMLElement): RawRow {
  const cells = getDirectCells(row);
  const raw: RawRow = {};

  cells.forEach((cell, index) => {
    const header = headers[index] ?? `column${index + 1}`;
    const value = extractCellText(cell);
    raw[header] = value.length > 0 ? value : null;
  });

  return raw;
}

function isEmptyRawRow(raw: RawRow): boolean {
  return Object.values(raw).every((value) => value === null || value === "");
}

function getAliasTokens(field: NormalizedField): readonly string[] {
  return FIELD_ALIASES[field].map(normalizeHeader);
}

function getContainsTokens(field: NormalizedField): readonly string[] {
  return CONTAINS_ALIASES[field].map(normalizeHeader);
}

function findRawValue(raw: RawRow, field: NormalizedField): RawRowValue {
  const aliasTokens = getAliasTokens(field);

  for (const [header, value] of Object.entries(raw)) {
    if (aliasTokens.includes(normalizeHeader(header))) {
      return value;
    }
  }

  const containsTokens = getContainsTokens(field);

  for (const [header, value] of Object.entries(raw)) {
    const normalizedHeader = normalizeHeader(header);

    if (
      containsTokens.some((token) => token.length > 0 && normalizedHeader.includes(token))
    ) {
      return value;
    }
  }

  return null;
}

function rawValueToString(value: string | number | null): string | null {
  if (value === null) {
    return null;
  }

  const text = cleanText(String(value));
  return text.length > 0 ? text : null;
}

function rawValueToNumber(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  const normalized = cleanText(value)
    .replaceAll(/[,，]/g, "")
    .replaceAll(/\s+/g, "");

  if (/[-−]\d/u.test(normalized)) {
    return null;
  }

  const match = /\d+(?:\.\d+)?/u.exec(normalized);

  if (!match) {
    return null;
  }

  const numericValue = Number(match[0]);

  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : null;
}

function inferSchoolName(raw: RawRow): string | null {
  for (const value of Object.values(raw)) {
    const text = rawValueToString(value);

    if (text && /(幼兒園|附幼|教保服務中心)/u.test(text)) {
      return text;
    }
  }

  return null;
}

function rawRowToKindergartenItem(
  raw: RawRow,
  context: ParseContext,
): KindergartenItem | null {
  const schoolName =
    rawValueToString(findRawValue(raw, "schoolName")) ?? inferSchoolName(raw);

  if (!schoolName) {
    return null;
  }

  return {
    id: buildKindergartenItemId(context, schoolName),
    schoolName,
    districtCode: context.districtCode,
    districtName: context.districtName,
    sourceType: context.sourceType,
    className: context.className,
    totalQuota: rawValueToNumber(findRawValue(raw, "totalQuota")),
    availableQuota: rawValueToNumber(findRawValue(raw, "availableQuota")),
    registeredCount: rawValueToNumber(findRawValue(raw, "registeredCount")),
    waitingCount: rawValueToNumber(findRawValue(raw, "waitingCount")),
    address: rawValueToString(findRawValue(raw, "address")),
    phone: rawValueToString(findRawValue(raw, "phone")),
    raw,
  };
}

export function parseKindergartenItems(
  html: string,
  context: ParseContext,
): KindergartenItem[] {
  const root = parse(html);
  const items: KindergartenItem[] = [];

  for (const table of root.querySelectorAll("table")) {
    const headerRow = getHeaderRow(table);

    if (!headerRow) {
      continue;
    }

    const headers = makeUniqueHeaders(getDirectCells(headerRow).map(extractCellText));
    const rows = table.querySelectorAll("tr");
    const headerIndex = rows.indexOf(headerRow);
    const dataRows = headerIndex >= 0 ? rows.slice(headerIndex + 1) : rows.slice(1);

    for (const row of dataRows) {
      const raw = rowToRawRecord(headers, row);

      if (isEmptyRawRow(raw)) {
        continue;
      }

      const item = rawRowToKindergartenItem(raw, context);

      if (item) {
        items.push(item);
      }
    }
  }

  return items;
}
