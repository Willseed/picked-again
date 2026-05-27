import { SERVICE_NAME } from "./constants";
import { getCorsHeaders, isAllowedRequest } from "./cors";
import { getHistoricalLotteryData, getLatestDataset } from "./kv";
import { mergeLiveSyncData } from "./raw-lottery";
import { syncAndStore } from "./sync";
import type { Env, KindergartenDataset } from "./types";

interface JsonResponseInit extends ResponseInit {
  headers?: HeadersInit;
}

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
