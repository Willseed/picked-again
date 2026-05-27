import { describe, expect, it } from "vitest";
import {
  getLatestDataset,
  putLatestDataset,
} from "../src/kv";
import type { Env, KindergartenDataset } from "../src/types";

interface StoredValue {
  readonly value: string;
  readonly metadata?: unknown;
}

interface MockEnv {
  readonly env: Env;
  readonly store: Map<string, StoredValue>;
}

function createMockEnv(initialStore: ReadonlyMap<string, StoredValue> = new Map()): MockEnv {
  const store = new Map(initialStore);
  const env = {
    KINDERGARTEN_KV: {
      async get(key: string): Promise<unknown> {
        const entry = store.get(key);
        return entry ? JSON.parse(entry.value) : null;
      },
      async put(key: string, value: string, options?: { readonly metadata?: unknown }): Promise<void> {
        store.set(key, { value, metadata: options?.metadata });
      },
    },
  } as unknown as Env;

  return { env, store };
}

function sampleDataset(): KindergartenDataset {
  return {
    schemaVersion: 2,
    source: "cloudflare-worker",
    updatedAt: "2026-05-27T00:00:00.000Z",
    timezone: "Asia/Taipei",
    public: {
      type: "public",
      name: "公立幼兒園",
      baseUrl: "https://example.test/public",
      updatedAt: "2026-05-27T00:00:00.000Z",
      districts: [],
    },
    nonProfit: {
      type: "nonProfit",
      name: "非營利幼兒園",
      baseUrl: "https://example.test/non-profit",
      updatedAt: "2026-05-27T00:00:00.000Z",
      districts: [],
    },
    errors: [],
  };
}

describe("KV storage", () => {
  it("stores schema v2 internally and raw latest data in pretty JSON", async () => {
    const { env, store } = createMockEnv();
    const dataset = sampleDataset();
    const rawLatest = {
      臺北市蘭州非營利幼兒園: {
        搜尋關鍵字: ["蘭州"],
        "5歲（115學年）": {
          正取: 4,
          備取: 6,
        },
      },
    };

    await putLatestDataset(env, dataset, rawLatest);

    expect(store.get("kindergarten:latest-dataset")?.value).toContain("\n  ");
    expect(store.get("kindergarten:latest")?.value).toContain("\n  ");
    expect(JSON.parse(store.get("kindergarten:latest")?.value ?? "{}")).toEqual(rawLatest);
    expect(await getLatestDataset(env)).toEqual(dataset);
  });

  it("falls back to legacy schema v2 in kindergarten:latest but ignores raw latest data", async () => {
    const dataset = sampleDataset();
    const legacyEnv = createMockEnv(
      new Map([
        ["kindergarten:latest", { value: JSON.stringify(dataset) }],
      ]),
    );
    const rawEnv = createMockEnv(
      new Map([
        [
          "kindergarten:latest",
          {
            value: JSON.stringify({
              臺北市蘭州非營利幼兒園: {
                "5歲（115學年）": { 正取: 4, 備取: 6 },
              },
            }),
          },
        ],
      ]),
    );

    expect(await getLatestDataset(legacyEnv.env)).toEqual(dataset);
    expect(await getLatestDataset(rawEnv.env)).toBeNull();
  });
});
