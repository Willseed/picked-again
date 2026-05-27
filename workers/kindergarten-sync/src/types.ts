export type SourceType = "public" | "nonProfit";

export interface Env {
  KINDERGARTEN_KV: KVNamespace;
  SYNC_SECRET?: string;
  ALLOWED_ORIGINS?: string;
}

export interface KindergartenDataset {
  schemaVersion: 2;
  source: "cloudflare-worker";
  updatedAt: string;
  timezone: "Asia/Taipei";
  public: KindergartenSourceDataset;
  nonProfit: KindergartenSourceDataset;
  errors?: SyncError[];
}

export interface KindergartenSourceDataset {
  type: SourceType;
  name: string;
  baseUrl: string;
  updatedAt: string;
  districts: KindergartenDistrictDataset[];
}

export interface KindergartenDistrictDataset {
  districtCode: string;
  districtName: string;
  classes: KindergartenClassDataset[];
}

export interface KindergartenClassDataset {
  className: string;
  fetchedAt: string;
  sourceUrl: string;
  items: KindergartenItem[];
}

export interface KindergartenItem {
  id: string;
  schoolName: string;
  districtCode: string;
  districtName: string;
  sourceType: SourceType;
  className: string;
  totalQuota?: number | null;
  availableQuota?: number | null;
  registeredCount?: number | null;
  waitingCount?: number | null;
  address?: string | null;
  phone?: string | null;
  raw?: Record<string, string | number | null>;
}

export interface SyncError {
  sourceType: SourceType;
  districtCode: string;
  districtName: string;
  className: string;
  message: string;
}

export interface SyncResult {
  updatedAt: string;
  publicCount: number;
  nonProfitCount: number;
  errors: SyncError[];
  syncedSourceType?: SourceType;
  nextSourceType?: SourceType;
}

export interface SourceConfig {
  readonly type: SourceType;
  readonly name: string;
  readonly baseUrl: string;
  readonly classes: readonly string[];
}

export interface SyncState {
  nextSourceType?: SourceType;
  lastSyncedSourceType?: SourceType;
  updatedAt?: string;
}
