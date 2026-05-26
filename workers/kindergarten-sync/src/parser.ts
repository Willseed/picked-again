import { parse } from "node-html-parser";
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

export function parseKindergartenItems(
  html: string,
  _context: ParseContext,
): KindergartenItem[] {
  parse(html);
  return [];
}
