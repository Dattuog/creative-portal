import "server-only";
import type { Store } from "./store/types";
import type { SyncRun } from "./types";
import { runSync } from "./sync";

let seeding: Promise<SyncRun> | null = null;

/** Local sample mode: the first visit seeds data once, even if several components ask at the same time. */
export async function latestSync(store: Store): Promise<SyncRun | null> {
  const s = await store.getLatestSyncRun();
  if (s || store.kind !== "local") return s;
  seeding ??= runSync(store).finally(() => {
    seeding = null;
  });
  return seeding;
}
