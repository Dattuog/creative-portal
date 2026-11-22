# Creative Performance Portal

Internal tool for a DTC brand: joins **Meta Ads** spend with **Shopify** revenue and a **Google Sheet** of who made each creative, shows performance per creative / editor / strategist, and runs an **AI agent** that proposes pause/scale actions — which only happen after a human approves them.

Stack: Next.js 16 (App Router) · TypeScript · Supabase (Postgres + Auth + RLS) · Vercel (hosting + cron) · OpenRouter (LLM).

## The three rules it's built around

| Rule | How it's enforced |
| --- | --- |
| **Data** — numbers match the source before anyone sees them | After each sync, stored ad-level spend is compared with Meta's *account-level* total, and fetched orders with Shopify's `ordersCount`. If a critical check fails, the dashboard shows **Unverified** and the agent refuses to run. Money is kept in integer cents; ROAS is always `sum(revenue) / sum(spend)`. |
| **Money** — anything that spends budget has limits and a human check | The LLM can only *propose*. Code validates every proposal against the numbers (it can't pause a winning ad), caps budget changes (±20% per ad set, €50/day total increase), computes the new budget itself, and re-checks everything again at approval time. Nothing hits Meta until an admin or strategist clicks Approve. |
| **Access** — least privilege, secrets out of code | Postgres row-level security: editors see only their own creatives, strategists see theirs plus the agent, admins see everything. All keys are environment variables; the service-role key is only used server-side. |

## Pages

- **Dashboard** — KPIs, daily spend vs revenue, Meta-vs-Shopify gap, tables by creative / editor / strategist (7/14/30 days).
- **AI agent** — latest report, approvable actions, and a "Caught by guardrails" list showing model proposals that code blocked and why.
- **Data checks** — every check from the latest sync with source vs stored values.

## Run locally (no keys needed)

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 18 tests: money parsing, timezones, attribution, RLS scoping, guardrails, end-to-end
```

Without keys it runs on **sample data emitted in the exact raw API shapes** Meta and Shopify return, so the same parsing code runs as in live mode. Use the **View as** switcher to see the app as an admin, strategist or editor.

## Going live

Copy `.env.example` to `.env.local` and fill in what you have — each source switches to live independently (the header shows `live` / `sample` per source).

1. **Supabase** — create a project, run `supabase/migrations/0001_init.sql` in the SQL editor, then add users in Auth and a row per user in `profiles` (`role` = admin / strategist / editor, `person_name` = their name in the owners sheet).
2. **Meta** — app with Marketing API, sandbox ad account, token with `ads_read` + `ads_management`. Keep `META_WRITE_MODE=dry_run` until you want approvals to really change Meta.
3. **Shopify** — dev store + custom app with `read_orders`. Ads must use the URL parameters `utm_source=facebook&utm_content={{ad.id}}`.
4. **Owners sheet** — columns `ad_id, ad_name, strategist, editor`; format `ad_id` as plain text; File → Share → Publish to web → CSV.
5. **OpenRouter** — `OPENROUTER_API_KEY`; model defaults to `nvidia/nemotron-3-ultra-550b-a55b:free`. If the model fails or returns invalid JSON, the agent falls back to rule-based proposals and labels the report as such.
6. **Vercel** — set the same env vars plus `CRON_SECRET`; `vercel.json` runs `/api/cron/daily` once a day (sync → agent).

## Things that are easy to get wrong (and are handled)

- Meta insights `spend` is a decimal string in **major** units, but ad set `daily_budget` is in **minor** units.
- Meta reports the same purchase under `omni_purchase`, `purchase` and `offsite_conversion.fb_pixel_purchase` — summing them triple-counts.
- Meta days are in the **ad account timezone**; Shopify timestamps are UTC. Orders are converted before grouping, otherwise late-evening orders land on the wrong day.
- Google Sheets turns long ad IDs into `1.20215E+17`; those rows are rejected and reported instead of silently mis-joined.
- Averaging per-creative ROAS overweights tiny-spend ads; totals are always ratio-of-sums.

## Known limits

- Meta **sandbox** ad accounts don't deliver ads, so they have structure (campaigns, ad sets, ads) but no spend. For a live demo, use real structure with sample insights, or a real ad account in read-only mode.
- Two admins approving budget increases at the same instant could both pass the daily cap check (no DB-level lock yet).
