import type { SourceConfig } from "./types";

export const SERVICE_NAME = "picked-again-kindergarten-sync";
export const TIMEZONE = "Asia/Taipei";
export const LATEST_KEY = "kindergarten:latest";
export const HISTORICAL_LOTTERY_DATA_KEY = "kindergarten:lottery-history";

export const DEFAULT_ALLOWED_ORIGINS = [
  "https://pick.pylot.space",
  "https://willseed.github.io",
  "http://localhost:4200",
] as const;

export const DISTRICTS = [
  "63000010",
  "63000020",
  "63000030",
  "63000040",
  "63000050",
  "63000060",
  "63000070",
  "63000080",
  "63000090",
  "63000100",
  "63000110",
  "63000120",
] as const;

export type DistrictCode = (typeof DISTRICTS)[number];

export const DISTRICT_NAMES = {
  "63000010": "松山區",
  "63000020": "信義區",
  "63000030": "大安區",
  "63000040": "中山區",
  "63000050": "中正區",
  "63000060": "大同區",
  "63000070": "萬華區",
  "63000080": "文山區",
  "63000090": "南港區",
  "63000100": "內湖區",
  "63000110": "士林區",
  "63000120": "北投區",
} as const satisfies Record<DistrictCode, string>;

export const PUBLIC_SOURCE_URL = "https://kid.tp.edu.tw";
export const NON_PROFIT_SOURCE_URL = "https://npkid.tp.edu.tw";

export const PUBLIC_SOURCE_CLASSES = ["3-5歲班", "2歲專班"] as const;
export const NON_PROFIT_SOURCE_CLASSES = [
  "5歲",
  "4歲",
  "3歲",
  "2歲專班",
] as const;

export const SOURCES = [
  {
    type: "public",
    name: "公立幼兒園",
    baseUrl: PUBLIC_SOURCE_URL,
    classes: PUBLIC_SOURCE_CLASSES,
  },
  {
    type: "nonProfit",
    name: "非營利幼兒園",
    baseUrl: NON_PROFIT_SOURCE_URL,
    classes: NON_PROFIT_SOURCE_CLASSES,
  },
] as const satisfies readonly SourceConfig[];
