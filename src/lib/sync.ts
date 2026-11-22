import { env } from "./env";
import type { Store } from "./store/types";
import type { SyncRun } from "./types";
import { addDays, todayInTimezone } from "./time";
import { inWindow as inWindowSafe } from "./metrics";
import { fetchMetaLive, majorStringToMinor, parseAds, parseAdsets, parseInsights, type MetaSnapshotRaw } from "./sources/meta";
import { fetchShopifyLive, parseOrders, type ShopifySnapshotRaw } from "./sources/shopify";
import { fetchOwnersCsvLive, parseOwners } from "./sources/sheet";
import { emptyOverrides, generateSample, sampleOwnersCsv, type SampleOverrides } from "./sample/generator";
import { runChecks } from "./reconcile";

export const SYNC_DAYS = 30;
export const OVERRIDES_KEY = "sample_overrides";

/** Complete days only: window ends yesterday in the ad account timezone. */
export function syncWindow(timeZone: string, now = new Date()) {
  const end = addDays(todayInTimezone(timeZone, now), -1);
  return { start: addDays(end, -(SYNC_DAYS - 1)), end };
}

export async function runSync(store: Store, now = new Date()): Promise<SyncRun> {
  const startedAt = now.toISOString();
  const settings = await store.getSettings();
  const mode = {
    meta: env.metaLive() ? "live" : "sample",
    shopify: env.shopifyOrdersLive() ? "live" : "sample",
    sheet: env.ownersCsvUrl() ? "live" : "sample",
  } as SyncRun["mode"];

  // Meta defines the timezone + currency everything else is aligned to.
  let tz = settings.accountTimezone;
  let { start, end } = syncWindow(tz, now);

  const run: SyncRun = {
    id: crypto.randomUUID(),
    startedAt,
    finishedAt: startedAt,
    mode,
    windowStart: start,
    windowEnd: end,
    rows: { creatives: 0, insights: 0, orders: 0, owners: 0 },
    checks: [],
    verified: false,
    error: null,
  };

  try {
    const overrides = (await store.kvGet<SampleOverrides>(OVERRIDES_KEY)) ?? emptyOverrides();
    let sample: ReturnType<typeof generateSample> | null = null;
    const getSample = () => (sample ??= generateSample(start, end, overrides, todayInTimezone(tz, now)));

    let metaRaw: MetaSnapshotRaw;
    if (mode.meta === "live") {
      metaRaw = await fetchMetaLive(start, end);
      if (metaRaw.account.timezone_name !== tz || metaRaw.account.currency !== settings.currency) {
        // Ad account settings win; re-fetch with the right day boundaries.
        tz = metaRaw.account.timezone_name;
        await store.saveSettings({ ...settings, accountTimezone: tz, currency: metaRaw.account.currency });
        ({ start, end } = syncWindow(tz, now));
        run.windowStart = start;
        run.windowEnd = end;
        metaRaw = await fetchMetaLive(start, end);
      }
    } else {
      metaRaw = getSample().meta;
    }
    const currency = metaRaw.account.currency;

    const shopRaw: ShopifySnapshotRaw = mode.shopify === "live" ? await fetchShopifyLive(start, end) : getSample().shopify;
    const csv = mode.sheet === "live" ? await fetchOwnersCsvLive() : sampleOwnersCsv();

    const adsets = parseAdsets(metaRaw.adsets);
    const creatives = parseAds(metaRaw.ads);
    const insights = parseInsights(metaRaw.insights).filter((r) => inWindowSafe(r.date, start, end));
    const orders = parseOrders(shopRaw.orders, tz).filter((o) => inWindowSafe(o.date, start, end));
    const { owners, problems } = parseOwners(csv);

    await store.writeSnapshot({ adsets, creatives, insights, orders, owners, start, end });

    run.rows = { creatives: creatives.length, insights: insights.length, orders: orders.length, owners: owners.length };
    run.checks = runChecks({
      sourceAccountSpendMinor: majorStringToMinor(metaRaw.accountSpend),
      storedInsights: insights,
      sourceOrderCount: shopRaw.sourceCount,
      fetchedOrderCount: shopRaw.orders.length,
      storedOrders: orders,
      creatives,
      owners,
      ownerProblems: problems,
      currency,
    });
    run.verified = run.checks.filter((c) => c.critical).every((c) => c.passed);
  } catch (e) {
    run.error = e instanceof Error ? e.message : String(e);
    run.verified = false;
  }
  run.finishedAt = new Date().toISOString();
  await store.saveSyncRun(run);
  return run;
}
