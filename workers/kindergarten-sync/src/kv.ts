import {
  HISTORICAL_LOTTERY_DATA_KEY,
  LATEST_DATASET_KEY,
  LATEST_KEY,
  SYNC_STATE_KEY,
} from "./constants";
import type { RawLotteryData } from "./raw-lottery";
import type { Env, KindergartenDataset, SyncState } from "./types";

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function isKindergartenDataset(value: unknown): value is KindergartenDataset {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { schemaVersion?: unknown }).schemaVersion === 2 &&
    (value as { source?: unknown }).source === "cloudflare-worker"
  );
}

export async function getHistoricalLotteryData(env: Env): Promise<unknown | null> {
  return env.KINDERGARTEN_KV.get(HISTORICAL_LOTTERY_DATA_KEY, "json");
}

export async function getLatestDataset(
  env: Env,
): Promise<KindergartenDataset | null> {
  const dataset = await env.KINDERGARTEN_KV.get<KindergartenDataset>(LATEST_DATASET_KEY, "json");

  if (dataset) {
    return dataset;
  }

  const legacyLatest = await env.KINDERGARTEN_KV.get<unknown>(LATEST_KEY, "json");

  return isKindergartenDataset(legacyLatest) ? legacyLatest : null;
}

export async function putLatestDataset(
  env: Env,
  dataset: KindergartenDataset,
  latestRawData: RawLotteryData,
): Promise<void> {
  await env.KINDERGARTEN_KV.put(LATEST_DATASET_KEY, prettyJson(dataset), {
    metadata: {
      updatedAt: dataset.updatedAt,
      schemaVersion: dataset.schemaVersion,
    },
  });
  await env.KINDERGARTEN_KV.put(LATEST_KEY, prettyJson(latestRawData), {
    metadata: {
      updatedAt: dataset.updatedAt,
      schemaVersion: "raw-lottery-data",
    },
  });
}

export async function getSyncState(env: Env): Promise<SyncState | null> {
  return env.KINDERGARTEN_KV.get<SyncState>(SYNC_STATE_KEY, "json");
}

export async function putSyncState(
  env: Env,
  state: SyncState,
): Promise<void> {
  await env.KINDERGARTEN_KV.put(SYNC_STATE_KEY, prettyJson(state), {
    metadata: {
      updatedAt: state.updatedAt,
      nextSourceType: state.nextSourceType,
    },
  });
}
