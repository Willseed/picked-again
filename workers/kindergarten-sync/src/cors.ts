import { DEFAULT_ALLOWED_ORIGINS } from "./constants";
import type { Env } from "./types";

export function getAllowedOrigins(env: Env): readonly string[] {
  const configuredOrigins = env.ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const origins =
    configuredOrigins && configuredOrigins.length > 0
      ? configuredOrigins
      : DEFAULT_ALLOWED_ORIGINS;

  return origins.filter((origin) => origin !== "*" && !origin.includes("*"));
}

export function getCorsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = {
    vary: "Origin",
  };

  if (origin && getAllowedOrigins(env).includes(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
    headers["access-control-allow-headers"] = "Content-Type, Authorization";
  }

  return headers;
}

export function isAllowedRequest(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");

  if (!origin) {
    return true;
  }

  return getAllowedOrigins(env).includes(origin);
}
