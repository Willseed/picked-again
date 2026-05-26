import { LATEST_KEY } from "./constants";
import type { Env, KindergartenDataset } from "./types";

export async function getLatestDataset(
  env: Env,
): Promise<KindergartenDataset | null> {
  return env.KINDERGARTEN_KV.get<KindergartenDataset>(LATEST_KEY, "json");
}

export async function putLatestDataset(
  env: Env,
  dataset: KindergartenDataset,
): Promise<void> {
  await env.KINDERGARTEN_KV.put(LATEST_KEY, JSON.stringify(dataset), {
    metadata: {
      updatedAt: dataset.updatedAt,
      schemaVersion: dataset.schemaVersion,
    },
  });
}
