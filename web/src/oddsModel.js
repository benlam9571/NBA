import { oddsEstimate, summary } from "./model.js";
export const DEFAULT_WEIGHTS = Object.freeze({ l10: 0.5, szn: 0.3, prev: 0.2 });
export const MARKET_STAT = Object.freeze({
  player_points: "pts",
  player_rebounds: "reb",
  player_assists: "ast",
  player_threes: "fg3m",
  player_points_rebounds_assists: "pra",
});
export const BOOK_NAMES = { sportsbet: "Sportsbet", tab: "TAB" };
export const ODDS_DISCLAIMER =
  "EV 只係歷史數據估計，未計傷病與上陣時間變動，唔代表保證回報。";
export function validateWeights(weights) {
  return (
    ["l10", "szn", "prev"].every(
      (k) => Number.isFinite(weights[k]) && weights[k] >= 0,
    ) && Object.values(weights).reduce((a, v) => a + v, 0) > 0
  );
}
export function validateOdds(data) {
  if (
    data?.schema_version !== 1 ||
    !["connected", "disconnected"].includes(data.status) ||
    !Array.isArray(data.rows) ||
    !Array.isArray(data.history || [])
  )
    throw Error("盤口快照格式有誤");
  if (
    data.status === "connected" &&
    !Number.isFinite(Date.parse(data.fetched_at))
  )
    throw Error("盤口快照時間有誤");
  const valid = (r) =>
    r &&
    typeof r.event_id === "string" &&
    typeof r.player_name === "string" &&
    typeof r.bookmaker === "string" &&
    MARKET_STAT[r.market] &&
    r.stat === MARKET_STAT[r.market] &&
    typeof r.eligible === "boolean" &&
    (r.pid === null || typeof r.pid === "string") &&
    Number.isFinite(r.analysis_line) &&
    r.analysis_line === Math.max(0.5, Math.floor(r.line) + 0.5) &&
    (!r.updated_at || Number.isFinite(Date.parse(r.updated_at))) &&
    Number.isFinite(r.line) &&
    r.line >= 0 &&
    Number.isFinite(r.over_price) &&
    r.over_price > 1 &&
    Number.isFinite(r.under_price) &&
    r.under_price > 1 &&
    Number.isFinite(Date.parse(r.fetched_at)) &&
    Number.isFinite(Date.parse(r.commence_time));
  if (!data.rows.every(valid) || !(data.history || []).every(valid))
    throw Error("盤口快照包含無效數值");
  return { ...data, history: data.history || [] };
}
export function quoteState(q, now = Date.now()) {
  if (Date.parse(q.commence_time) <= now) return "started";
  if (
    now - Date.parse(q.fetched_at) > 24 * 3600000 ||
    now - Date.parse(q.updated_at || q.fetched_at) > 24 * 3600000
  )
    return "stale";
  return "active";
}
export function analyzeQuote(
  model,
  q,
  weights = DEFAULT_WEIGHTS,
  side = "over",
) {
  const games = model.byPlayer.get(String(q.pid));
  if (!q.eligible || !games || !MARKET_STAT[q.market] || q.line % 1 !== 0.5)
    return null;
  const s = summary(games, q.stat, q.analysis_line),
    rates = { l10: s.l10.rate, szn: s.szn.rate, prev: s.prev.rate };
  const o = oddsEstimate(rates, q.over_price, q.under_price, weights);
  const estimated =
      side === "under" && o.estimated !== null ? 1 - o.estimated : o.estimated,
    fair = side === "under" ? 1 - o.fair : o.fair,
    price = side === "under" ? q.under_price : q.over_price;
  return {
    ...q,
    side,
    price,
    estimated,
    fair,
    edge: estimated === null ? null : estimated - fair,
    ev: estimated === null ? null : estimated * price - 1,
    team: games[0].team,
    player: games[0].player,
    samples: { l10: s.l10.n, szn: s.szn.n, prev: s.prev.n },
  };
}
export function rankOdds(
  model,
  odds,
  { weights = DEFAULT_WEIGHTS, side = "over", now = Date.now() } = {},
) {
  const best = new Map();
  for (const q of odds?.rows || []) {
    if (quoteState(q, now) !== "active") continue;
    const r = analyzeQuote(model, q, weights, side);
    if (!r || r.ev === null) continue;
    const key = [r.event_id, r.pid, r.market, r.line].join("|"),
      old = best.get(key);
    if (
      !old ||
      r.price > old.price ||
      (r.price === old.price && r.bookmaker.localeCompare(old.bookmaker) < 0)
    )
      best.set(key, r);
  }
  return [...best.values()].sort(
    (a, b) => b.ev - a.ev || a.player.localeCompare(b.player),
  );
}
export const quoteKey = (q) =>
  [q.event_id, q.pid, q.market, q.line, q.bookmaker].join("|");
export function movement(odds, pid, stat, eventId) {
  const seen = new Set();
  return [...(odds?.history || []), ...(odds?.rows || [])]
    .filter((q) => q.pid === pid && q.stat === stat && q.event_id === eventId)
    .sort((a, b) => a.fetched_at.localeCompare(b.fetched_at))
    .filter((q) => {
      const key = quoteKey(q) + "|" + q.fetched_at;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
export const signedPct = (n) =>
  n == null ? "—" : (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%";
export function initialWeights() {
  try {
    const w = JSON.parse(localStorage.getItem("nba-odds-weights"));
    return validateWeights(w) ? w : DEFAULT_WEIGHTS;
  } catch {
    return DEFAULT_WEIGHTS;
  }
}
