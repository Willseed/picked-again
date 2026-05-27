import { afterEach, describe, expect, it, vi } from "vitest";
import { DISTRICTS } from "../src/constants";
import { syncAndStore } from "../src/sync";
import type { Env, SourceType } from "../src/types";

const originalFetch = globalThis.fetch;

interface StoredValue {
  readonly value: string;
}

function createMockEnv(initialState: { readonly nextSourceType?: SourceType } = {}): Env {
  const store = new Map<string, StoredValue>();

  if (initialState.nextSourceType) {
    store.set("kindergarten:sync-state", {
      value: JSON.stringify({ nextSourceType: initialState.nextSourceType }),
    });
  }

  return {
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
              <th>總登記人數</th>
              <th>備取人數</th>
            </tr>
            <tr>
              <td>${className}測試非營利幼兒園</td>
              <td>4</td>
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
    const env = createMockEnv();
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
  });
});
