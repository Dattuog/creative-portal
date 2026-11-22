import type { Store } from "../store/types";
import { env } from "../env";
import { addDays, todayInTimezone } from "../time";
import { createShopifyOrder } from "../sources/shopify";
import { emptyOverrides, generateSample, type SampleOverrides } from "./generator";
import { OVERRIDES_KEY, syncWindow } from "../sync";

export const SEEDED_KEY = "shopify_seeded_through";

/**
 * Loads the sample orders into the Shopify dev store, one day at a time, so the
 * live Shopify path has data that lines up with the sample Meta spend.
 * Resumable: remembers the last day completed and stops before the time budget.
 */
export async function seedShopify(store: Store, budgetMs = 240_000) {
  if (!env.shopifyLive()) throw new Error("Shopify is not connected.");
  const started = Date.now();
  const settings = await store.getSettings();
  const tz = settings.accountTimezone;
  const { start, end } = syncWindow(tz);
  const done = await store.kvGet<string>(SEEDED_KEY);
  let day = done && done >= start ? addDays(done, 1) : start;
  const overrides = (await store.kvGet<SampleOverrides>(OVERRIDES_KEY)) ?? emptyOverrides();
  let created = 0;

  while (day <= end && Date.now() - started < budgetMs) {
    const { shopify } = generateSample(day, day, overrides, todayInTimezone(tz));
    const queue = [...shopify.orders];
    const worker = async () => {
      for (let o = queue.shift(); o; o = queue.shift()) {
        const attr = (k: string) => o.customAttributes.find((a) => a.key === k)?.value ?? undefined;
        await createShopifyOrder({
          totalMajor: o.currentTotalPriceSet.shopMoney.amount,
          currency: o.currentTotalPriceSet.shopMoney.currencyCode,
          processedAt: o.createdAt,
          utmSource: attr("utm_source"),
          utmContent: attr("utm_content"),
        });
        created++;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    await store.kvSet(SEEDED_KEY, day);
    day = addDays(day, 1);
  }
  return { created, seededThrough: addDays(day, -1), remainingDays: Math.max(0, daysBetween(day, end) + 1), windowEnd: end };
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
