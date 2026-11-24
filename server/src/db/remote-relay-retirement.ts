import { getSqlite } from "./index.js";

// DSK-017 retired the legacy paired/self-hosted Relay. Its persisted table held
// the enabled flag, custom endpoint and encrypted host/client tokens. Dropping
// the table is the narrowest way to guarantee that an upgraded Host can never
// read or regenerate that identity. DROP TABLE IF EXISTS makes the migration
// idempotent, and the table belongs solely to the retired feature.
export const retireLegacyRemoteRelaySettings = (): void => {
  getSqlite().exec("DROP TABLE IF EXISTS remote_relay_settings");
};
