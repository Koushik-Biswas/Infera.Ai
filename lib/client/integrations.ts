/**
 * Which connection methods this server supports (GET /api/v1/integrations), so the console
 * only offers options that will work. `telegram` is false when the server has no valid
 * TELEGRAM_API_ID / TELEGRAM_API_HASH — users never enter those themselves.
 */
import { useApi } from "./api";

export type Integrations = { google: boolean; telegram: boolean; liveSync: boolean };

export const INTEGRATIONS_PATH = "/api/v1/integrations";

/** Undefined while loading. */
export const useIntegrations = () => useApi<Integrations>(INTEGRATIONS_PATH, { staleMs: 60_000 }).data;
