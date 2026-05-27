import { HISTORICAL_LOTTERY_DATA_KEY, LATEST_KEY, SYNC_STATE_KEY } from "./constants";
import type { Env, KindergartenDataset, SyncState } from "./types";

export async function getHistoricalLotteryData(env: Env): Promise<unknown | null> {
  return env.KINDERGARTEN_KV.get(HISTORICAL_LOTTERY_DATA_KEY, "json");
}

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

export async function getSyncState(env: Env): Promise<SyncState | null> {
  return env.KINDERGARTEN_KV.get<SyncState>(SYNC_STATE_KEY, "json");
}

export async function putSyncState(
  env: Env,
  state: SyncState,
): Promise<void> {
  await env.KINDERGARTEN_KV.put(SYNC_STATE_KEY, JSON.stringify(state), {
    metadata: {
      updatedAt: state.updatedAt,
      nextSourceType: state.nextSourceType,
    },
  });
}
