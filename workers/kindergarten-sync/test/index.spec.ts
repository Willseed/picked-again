import { describe, expect, it } from "vitest";
import { mergeLiveSyncData } from "../src/raw-lottery";
import type { KindergartenDataset } from "../src/types";

describe("mergeLiveSyncData", () => {
  it("merges 115 live records into historical schools matched by search aliases", () => {
    const historicalData = {
      臺北市蘭州非營利幼兒園: {
        搜尋關鍵字: ["蘭州非營利幼兒園", "蘭州", "大同區"],
        "2歲專班（113學年）": { 正取: 0, 備取: 68 },
        "5歲（114學年）": { 正取: 0, 備取: 2 },
      },
    };
    const liveDataset = {
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
        districts: [
          {
            districtCode: "103",
            districtName: "大同區",
            classes: [
              {
                className: "5歲",
                fetchedAt: "2026-05-27T00:00:00.000Z",
                sourceUrl: "https://example.test/non-profit/5",
                items: [
                  {
                    id: "nonProfit:103:5歲:蘭州非營利幼兒園",
                    schoolName: "蘭州非營利幼兒園",
                    districtCode: "103",
                    districtName: "大同區",
                    sourceType: "nonProfit",
                    className: "5歲",
                    availableQuota: 8,
                    waitingCount: 6,
                    registeredCount: 10,
                    raw: {
                      公告缺額: "8",
                      "順序1-4": "1",
                      順序5: "0",
                      順序6: "1",
                      順序7: "0",
                      順序8: "2",
                      順序9: "6",
                      總登記人數: "10",
                    },
                  },
                ],
              },
              {
                className: "2歲專班",
                fetchedAt: "2026-05-27T00:00:00.000Z",
                sourceUrl: "https://example.test/non-profit/2",
                items: [
                  {
                    id: "nonProfit:103:2歲專班:蘭州非營利幼兒園",
                    schoolName: "蘭州非營利幼兒園",
                    districtCode: "103",
                    districtName: "大同區",
                    sourceType: "nonProfit",
                    className: "2歲專班",
                    availableQuota: 2,
                    waitingCount: 8,
                  },
                ],
              },
            ],
          },
        ],
      },
    } satisfies KindergartenDataset;

    const mergedData = mergeLiveSyncData(historicalData, liveDataset);

    expect(Object.keys(mergedData)).toEqual(["臺北市蘭州非營利幼兒園"]);
    expect(mergedData["臺北市蘭州非營利幼兒園"]?.["5歲（115學年）"]).toMatchObject({
      正取: 4,
      備取: 2,
      公告缺額: 8,
      總登記人數: 10,
      各序位: {
        "順序1-4": 1,
        順序5: 0,
        順序6: 1,
        順序7: 0,
        順序8: 2,
        順序9: 6,
      },
      優先順序: 4,
      一般缺額: 4,
      一般順序: 6,
    });
    expect(mergedData["臺北市蘭州非營利幼兒園"]?.["2歲專班（115學年）"]).toMatchObject({
      正取: 2,
      備取: 8,
    });
    expect(mergedData["臺北市蘭州非營利幼兒園"]?.["搜尋關鍵字"]).toEqual([
      "蘭州非營利幼兒園",
      "蘭州",
      "大同區",
      "非營利幼兒園",
      "nonProfit",
    ]);
  });
});
