// Single place that reads environment variables. Secrets never live in code.
const v = (k: string) => {
  const x = process.env[k];
  return x && x.trim() !== "" ? x.trim() : undefined;
};

export const env = {
  // Supabase
  supabaseUrl: () => v("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => v("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => v("SUPABASE_SERVICE_ROLE_KEY"),
  useSupabase: () => !!(v("NEXT_PUBLIC_SUPABASE_URL") && v("NEXT_PUBLIC_SUPABASE_ANON_KEY") && v("SUPABASE_SERVICE_ROLE_KEY")),

  // Meta
  metaToken: () => v("META_ACCESS_TOKEN"),
  metaAdAccountId: () => {
    const id = v("META_AD_ACCOUNT_ID");
    if (!id) return undefined;
    return id.startsWith("act_") ? id : `act_${id}`;
  },
  metaApiVersion: () => v("META_API_VERSION") ?? "v27.0",
  metaLive: () => !!(v("META_ACCESS_TOKEN") && v("META_AD_ACCOUNT_ID")),
  /** "live" = actually call Meta on approval. Anything else = dry run. */
  metaWriteMode: () => (v("META_WRITE_MODE") === "live" ? "live" : "dry_run") as "live" | "dry_run",

  // Shopify
  shopifyDomain: () => v("SHOPIFY_STORE_DOMAIN"),
  /** Optional fixed token (older admin-created apps). Dev Dashboard apps use client credentials instead. */
  shopifyToken: () => v("SHOPIFY_ADMIN_TOKEN"),
  shopifyClientId: () => v("SHOPIFY_CLIENT_ID"),
  shopifyClientSecret: () => v("SHOPIFY_CLIENT_SECRET"),
  shopifyApiVersion: () => v("SHOPIFY_API_VERSION") ?? "2026-10",
  /**
   * Dashboard order history: "live" reads every order from Shopify; "sample" keeps the
   * sample history (Shopify dev stores only allow ~5 API-created orders a minute).
   */
  shopifyOrdersLive: () => env.shopifyLive() && v("SHOPIFY_ORDERS") !== "sample",
  shopifyLive: () =>
    !!(v("SHOPIFY_STORE_DOMAIN") && (v("SHOPIFY_ADMIN_TOKEN") || (v("SHOPIFY_CLIENT_ID") && v("SHOPIFY_CLIENT_SECRET")))),

  // Google Sheet (published CSV link)
  ownersCsvUrl: () => v("OWNERS_SHEET_CSV_URL"),

  // LLM via OpenRouter
  openrouterKey: () => v("OPENROUTER_API_KEY"),
  openrouterModel: () => v("OPENROUTER_MODEL") ?? "nvidia/nemotron-3-ultra-550b-a55b:free",

  // Protects cron endpoints
  cronSecret: () => v("CRON_SECRET"),

  // Local sample-data store location
  dataDir: () => v("DATA_DIR") ?? (process.env.VERCEL ? "/tmp/creative-portal" : ".data"),
};
