import type {
  ConnectionCheckResult,
  ConnectionCheckStatus,
  GptzeroStatus,
  KeyProvider,
  KeyStatus,
  PublicSettings,
  Settings,
  Stats,
} from './shared';

export type Dashboard = {
  settings: PublicSettings;
  stats: Stats;
  keyStatus: KeyStatus;
  permissionStatus: KeyStatus;
  connectionCheck: ConnectionCheckStatus | null;
  connectionResult: ConnectionCheckResult | null;
  gptzero: GptzeroStatus;
  gptzeroConnecting: boolean;
};

export type PopupRequest =
  | {
      type:
        | 'getDashboard'
        | 'connectGptzero'
        | 'refreshGptzeroUsage'
        | 'cancelConnection'
        | 'clearCache';
    }
  | { type: 'saveSettings'; settings: Partial<Settings> }
  | { type: 'connect'; provider: KeyProvider; apiKey: string }
  | { type: 'disconnect'; provider: KeyProvider };

export type PopupResponses = {
  getDashboard: Dashboard;
  saveSettings: { ok: true; settings: PublicSettings };
  connect:
    | { ok: true; settings: PublicSettings; keyStatus: KeyStatus; latencyMs: number }
    | { ok: false; message: string; code?: string };
  disconnect: { ok: true; settings: PublicSettings; keyStatus: KeyStatus };
  connectGptzero: { ok: true; gptzero: GptzeroStatus; settings: PublicSettings };
  refreshGptzeroUsage: { gptzero: GptzeroStatus };
  cancelConnection: { ok: true };
  clearCache: { ok: true };
};
