import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { TRACKED_TICKERS } from "../tokens";

let rootEnvCache;

function getEnv(name) {
  if (process.env[name]) return process.env[name];
  if (!rootEnvCache) {
    rootEnvCache = {};
    const envPath = path.resolve(process.cwd(), "..", ".env");
    try {
      const raw = fs.readFileSync(envPath, "utf8");
      raw.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const eq = trimmed.indexOf("=");
        if (eq === -1) return;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
        if (key) rootEnvCache[key] = value;
      });
    } catch {}
  }
  return rootEnvCache[name];
}

/**
 * Writes one row per ticker with count &gt; 0 so `/api/zscores` can build trends over time.
 * Expects columns `ticker`, `count`, `timestamp` (unix seconds); add optional `source` in Supabase with default if needed.
 */
export async function persistMentionSnapshotFromCounts(counts) {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_KEY");
  if (!url || !key || !counts || typeof counts !== "object") return;

  const ts = Math.floor(Date.now() / 1000);
  const minimal = [];
  for (const ticker of TRACKED_TICKERS) {
    const n = Number(counts[ticker] ?? 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    minimal.push({ ticker, count: n, timestamp: ts });
  }

  if (minimal.length === 0) return;

  try {
    const supabase = createClient(url, key);
    const withSource = minimal.map((r) => ({ ...r, source: "live_app" }));
    let { error } = await supabase.from("mentions").insert(withSource);
    if (error) {
      ({ error } = await supabase.from("mentions").insert(minimal));
    }
    if (error) throw error;
  } catch (e) {
    console.warn("[mentions] snapshot insert failed:", e.message);
  }
}
