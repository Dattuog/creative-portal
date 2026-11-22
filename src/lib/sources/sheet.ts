import type { OwnerRow } from "../types";
import { env } from "../env";

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function parseOwners(csv: string): { owners: OwnerRow[]; problems: string[] } {
  const rows = parseCsv(csv);
  const problems: string[] = [];
  if (rows.length === 0) return { owners: [], problems: ["Sheet is empty"] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (n: string) => header.indexOf(n);
  const [iAd, iS, iE] = [idx("ad_id"), idx("strategist"), idx("editor")];
  if (iAd < 0 || iS < 0 || iE < 0) {
    return { owners: [], problems: [`Sheet needs columns ad_id, strategist, editor (got: ${header.join(", ")})`] };
  }
  const seen = new Set<string>();
  const owners: OwnerRow[] = [];
  rows.slice(1).forEach((r, n) => {
    // Sheets often turns long IDs into 1.20215E+17 — reject instead of silently mis-joining.
    const adId = (r[iAd] ?? "").trim();
    if (!/^\d+$/.test(adId)) {
      problems.push(`Row ${n + 2}: ad_id "${adId}" is not a plain number (format the column as text)`);
      return;
    }
    if (seen.has(adId)) {
      problems.push(`Row ${n + 2}: duplicate ad_id ${adId}`);
      return;
    }
    seen.add(adId);
    owners.push({ adId, strategist: (r[iS] ?? "").trim(), editor: (r[iE] ?? "").trim() });
  });
  return { owners, problems };
}

export async function fetchOwnersCsvLive(): Promise<string> {
  const res = await fetch(env.ownersCsvUrl()!, { cache: "no-store", redirect: "follow" });
  if (!res.ok) throw new Error(`Owners sheet fetch failed: ${res.status}`);
  return res.text();
}
