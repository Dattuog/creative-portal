import type { OrderRow } from "../types";
import { env } from "../env";
import { dateInTimezone, addDays } from "../time";

/* ---------- Raw GraphQL Admin API node shape ---------- */
export interface ShopifyOrderNode {
  id: string; // gid://shopify/Order/123
  name: string;
  createdAt: string; // ISO UTC, when the record was created in Shopify
  processedAt?: string | null; // ISO UTC, when the sale happened (differs for imported orders)
  test: boolean;
  cancelledAt: string | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customAttributes: { key: string; value: string | null }[];
  customerJourneySummary: {
    lastVisit: { utmParameters: { source: string | null; content: string | null } | null } | null;
  } | null;
}

export interface ShopifySnapshotRaw {
  orders: ShopifyOrderNode[];
  /** Independent count from ordersCount for the same query (used by the data check). */
  sourceCount: number;
}

/**
 * Attribution: ads use URL params `utm_source=facebook&utm_content={{ad.id}}`.
 * Real storefront orders carry them in customerJourneySummary; orders created
 * through the API (sample/dev-store orders) carry them as custom attributes.
 */
export function attributionOf(n: ShopifyOrderNode): { source: string | null; adId: string | null } {
  const utm = n.customerJourneySummary?.lastVisit?.utmParameters;
  const attr = (k: string) => n.customAttributes?.find((a) => a.key === k)?.value ?? null;
  const source = utm?.source ?? attr("utm_source");
  const content = utm?.content ?? attr("utm_content");
  const isMeta = !!source && /^(facebook|fb|instagram|ig|meta)$/i.test(source);
  const adId = isMeta && content && /^\d+$/.test(content) ? content : null;
  return { source, adId };
}

export function parseOrders(nodes: ShopifyOrderNode[], accountTimezone: string): OrderRow[] {
  return nodes
    .filter((n) => !n.test && !n.cancelledAt)
    .map((n) => {
      const { source, adId } = attributionOf(n);
      const money = n.currentTotalPriceSet.shopMoney;
      const [int, frac = ""] = money.amount.split(".");
      return {
        orderId: n.id.split("/").pop()!,
        createdAt: n.processedAt ?? n.createdAt,
        date: dateInTimezone(n.processedAt ?? n.createdAt, accountTimezone),
        totalMinor: Number(int) * 100 + Number((frac + "00").slice(0, 2)),
        currency: money.currencyCode,
        utmSource: source,
        attributedAdId: adId,
      };
    });
}

/* ---------- Live client ---------- */

/**
 * Dev Dashboard apps (the only kind Shopify allows since 2026) authenticate with
 * the client credentials grant. Tokens last 24 h, so cache and refresh early.
 */
let cached: { token: string; expiresAt: number } | null = null;

export async function shopifyAccessToken(now = Date.now()): Promise<string> {
  const fixed = env.shopifyToken();
  if (fixed) return fixed;
  if (cached && cached.expiresAt - 5 * 60_000 > now) return cached.token;
  const res = await fetch(`https://${env.shopifyDomain()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.shopifyClientId()!,
      client_secret: env.shopifyClientSecret()!,
    }),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Shopify token request failed (${res.status}): ${body.error_description ?? body.error ?? "no token returned"}`);
  }
  cached = { token: body.access_token, expiresAt: now + Number(body.expires_in ?? 86399) * 1000 };
  return cached.token;
}

export function resetShopifyTokenCache() {
  cached = null;
}

async function gql<T>(query: string, variables: Record<string, unknown>, attempt = 0): Promise<T> {
  const url = `https://${env.shopifyDomain()}/admin/api/${env.shopifyApiVersion()}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await shopifyAccessToken() },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  const throttled = res.status === 429 || JSON.stringify(body.errors ?? "").includes("THROTTLED");
  if (throttled && attempt < 6) {
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    return gql<T>(query, variables, attempt + 1);
  }
  if (!res.ok || body.errors) throw new Error(`Shopify API: ${JSON.stringify(body.errors ?? res.status)}`);
  return body.data as T;
}

const ORDERS_Q = `query($q: String!, $after: String) {
  orders(first: 250, after: $after, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt processedAt test cancelledAt
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      customAttributes { key value }
      customerJourneySummary { lastVisit { utmParameters { source content } } }
    }
  }
}`;
const COUNT_Q = `query($q: String!) { ordersCount(query: $q, limit: null) { count } }`;

/**
 * Fetch a UTC window one day wider on each side, because the ad account
 * timezone day boundaries don't line up with UTC. Rows are later filtered
 * to the account-timezone window.
 */
export async function fetchShopifyLive(start: string, end: string): Promise<ShopifySnapshotRaw> {
  // processed_at is the sale time; it differs from created_at for imported orders.
  const q = `processed_at:>=${addDays(start, -1)} processed_at:<=${addDays(end, 1)}T23:59:59Z`;
  const orders: ShopifyOrderNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < 40; page++) {
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: ShopifyOrderNode[] } } =
      await gql(ORDERS_Q, { q, after });
    orders.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  const c = await gql<{ ordersCount: { count: number } }>(COUNT_Q, { q });
  return { orders, sourceCount: c.ordersCount.count };
}

/** Used only to put sample orders into a dev store so the live path has data. */
export async function createShopifyOrder(input: {
  totalMajor: string;
  currency: string;
  processedAt: string;
  utmSource?: string;
  utmContent?: string;
}) {
  const m = `mutation($order: OrderCreateOrderInput!) {
    orderCreate(order: $order) { order { id } userErrors { field message } }
  }`;
  const attrs = [
    ...(input.utmSource ? [{ key: "utm_source", value: input.utmSource }] : []),
    ...(input.utmContent ? [{ key: "utm_content", value: input.utmContent }] : []),
  ];
  const data = await gql<{ orderCreate: { userErrors: { message: string }[] } }>(m, {
    order: {
      currency: input.currency,
      processedAt: input.processedAt,
      customAttributes: attrs,
      lineItems: [
        {
          title: "Sample order",
          quantity: 1,
          priceSet: { shopMoney: { amount: input.totalMajor, currencyCode: input.currency } },
        },
      ],
      financialStatus: "PAID",
    },
  });
  if (data.orderCreate.userErrors.length) throw new Error(data.orderCreate.userErrors.map((e) => e.message).join("; "));
}

/* ---------- Connection proof: recent real orders from the store ---------- */

const RECENT_Q = `query { orders(first: 5, sortKey: PROCESSED_AT, reverse: true) {
  nodes {
    id name createdAt processedAt test cancelledAt
    currentTotalPriceSet { shopMoney { amount currencyCode } }
    customAttributes { key value }
    customerJourneySummary { lastVisit { utmParameters { source content } } }
  }
} }`;

export async function fetchRecentShopifyOrders(accountTimezone: string) {
  const data = await gql<{ orders: { nodes: ShopifyOrderNode[] } }>(RECENT_Q, {});
  return data.orders.nodes.map((n) => ({ name: n.name, ...parseOrders([{ ...n, test: false, cancelledAt: null }], accountTimezone)[0] }));
}
