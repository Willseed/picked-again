import { afterEach, describe, expect, it, vi } from "vitest";
import { DISTRICTS } from "../src/constants";
import { syncAndStore } from "../src/sync";
import type { Env, SourceType } from "../src/types";

const originalFetch = globalThis.fetch;

interface StoredValue {
  readonly value: string;
}

interface MockEnv {
  readonly env: Env;
  readonly store: Map<string, StoredValue>;
}

function createMockEnv(initialState: { readonly nextSourceType?: SourceType } = {}): MockEnv {
  const store = new Map<string, StoredValue>();

  if (initialState.nextSourceType) {
    store.set("kindergarten:sync-state", {
      value: JSON.stringify({ nextSourceType: initialState.nextSourceType }),
    });
  }

  const env = {
    KINDERGARTEN_KV: {
      async get(key: string): Promise<unknown | null> {
        const entry = store.get(key);
        return entry ? JSON.parse(entry.value) : null;
      },
      async put(key: string, value: string): Promise<void> {
        store.set(key, { value });
      },
    },
  } as unknown as Env;

  return { env, store };
}

function classPageHtml(className: string): string {
  return `
    <html>
      <body>
        <form action="/Board.aspx">
          <input type="hidden" name="__VIEWSTATE" value="view">
          <input type="hidden" name="__VIEWSTATEGENERATOR" value="generator">
          <input type="hidden" name="__EVENTVALIDATION" value="validation">
          <input type="hidden" id="MainContent_classname" name="MainContent$classname" value="${className}">
          ${["5歲", "4歲", "3歲", "2歲專班"]
            .map(
              (age, index) => `
                <label for="class_${index}">
                  ${age}
                </label>
                <input
                  id="class_${index}"
                  name="classType"
                  type="radio"
                  value="${age}"
                  ${age === className ? "checked" : ""}
                >
              `,
            )
            .join("")}
          <table>
            <tr>
              <th>幼兒園名稱</th>
              <th>公告缺額</th>
              <th>順序1-4</th>
              <th>順序5</th>
              <th>順序6</th>
              <th>順序7</th>
              <th>順序8</th>
              <th>順序9</th>
              <th>總登記人數</th>
              <th>備取人數</th>
            </tr>
            <tr>
              <td>${className}測試非營利幼兒園</td>
              <td>8</td>
              <td>1</td>
              <td>0</td>
              <td>1</td>
              <td>0</td>
              <td>2</td>
              <td>6</td>
              <td>10</td>
              <td>6</td>
            </tr>
          </table>
        </form>
      </body>
    </html>
  `;
}

describe("syncAndStore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("syncs one source per invocation so nonProfit stays under the Worker subrequest limit", async () => {
    const { env, store } = createMockEnv();
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body instanceof URLSearchParams ? init.body : null;
      const className = body?.get("classType") ?? "5歲";

      return new Response(classPageHtml(className), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "ASP.NET_SessionId=test; path=/",
        },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await syncAndStore(env);

    expect(result.syncedSourceType).toBe("nonProfit");
    expect(result.nextSourceType).toBe("public");
    expect(fetchMock).toHaveBeenCalledTimes(DISTRICTS.length * 4);
    expect(result.nonProfitCount).toBe(DISTRICTS.length * 4);
    expect(result.publicCount).toBe(0);
    expect(result.errors).toEqual([]);

    const latestRawJson = store.get("kindergarten:latest")?.value ?? "";
    const latestDatasetJson = store.get("kindergarten:latest-dataset")?.value ?? "";
    const syncStateJson = store.get("kindergarten:sync-state")?.value ?? "";
    const latestRaw = JSON.parse(latestRawJson) as Record<string, Record<string, unknown>>;

    expect(latestRawJson).toContain("\n  ");
    expect(latestDatasetJson).toContain("\n  ");
    expect(syncStateJson).toContain("\n  ");
    expect(latestRaw["5歲測試非營利幼兒園"]?.["5歲（115學年）"]).toMatchObject({
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
      資料來源: "非營利幼兒園 / nonProfit",
    });
    expect(latestRaw["5歲測試非營利幼兒園"]?.["id"]).toBeUndefined();
  });
});
