export const CURRENT = "2026-27";
export const STATS = {
  pts: "得分",
  reb: "籃板",
  ast: "助攻",
  fg3m: "三分命中",
  pra: "得分＋籃板＋助攻",
  pr: "得分＋籃板",
  pa: "得分＋助攻",
  ra: "籃板＋助攻",
  stl: "抄截",
  blk: "封阻",
  stk: "抄截＋封阻",
  tov: "失誤",
};
export const WINDOWS = {
  l5: "近 5 場",
  l10: "近 10 場",
  szn: "今季",
  prev: "上季",
  home: "今季主場",
  away: "今季客場",
};
export const normalizeLine = (x) =>
  Math.max(0.5, Math.floor(Number.isFinite(+x) ? +x : 0) + 0.5);
export const avg = (rows, key) =>
  rows.length ? rows.reduce((a, r) => a + r[key], 0) / rows.length : null;
export function windows(g) {
  return {
    l5: g.slice(0, 5),
    l10: g.slice(0, 10),
    szn: g.filter((r) => r.season === CURRENT),
    prev: g.filter((r) => r.season !== CURRENT),
    home: g.filter((r) => r.season === CURRENT && r.ha === "H"),
    away: g.filter((r) => r.season === CURRENT && r.ha === "A"),
  };
}
export const defaultLine = (g, s) => normalizeLine(avg(g.slice(0, 10), s) ?? 0);
export function summary(g, s, line) {
  return Object.fromEntries(
    Object.entries(windows(g)).map(([k, r]) => [
      k,
      {
        n: r.length,
        over: r.filter((x) => x[s] > line).length,
        rate: r.length ? r.filter((x) => x[s] > line).length / r.length : null,
        avg: avg(r, s),
      },
    ]),
  );
}
export function aest(tip) {
  const d = new Date(new Date(tip).getTime() + 10 * 3600000);
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toISOString().slice(11, 16),
  };
}
export function createModel(snapshot) {
  const byPlayer = new Map(),
    records = new Map(snapshot.teams.map((t) => [t.team, { w: 0, l: 0 }])),
    seen = new Set();
  const games = snapshot.games.map((r) => ({
    ...r,
    pid: String(r.pid),
    game_id: String(r.game_id),
    pra: r.pts + r.reb + r.ast,
    pr: r.pts + r.reb,
    pa: r.pts + r.ast,
    ra: r.reb + r.ast,
    stk: r.stl + r.blk,
  }));
  for (const r of games) {
    if (!byPlayer.has(r.pid)) byPlayer.set(r.pid, []);
    byPlayer.get(r.pid).push(r);
    if (r.season === CURRENT && !seen.has(r.team + "|" + r.game_id)) {
      seen.add(r.team + "|" + r.game_id);
      const rec = records.get(r.team);
      if (rec) rec[r.wl === "W" ? "w" : "l"]++;
    }
  }
  for (const g of byPlayer.values())
    g.sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.game_id.localeCompare(a.game_id),
    );
  const players = [...byPlayer].map(([pid, g]) => ({ ...g[0], pid, games: g }));
  const schedule = snapshot.schedule
    .map((g) => ({ ...g, us_date: g.date, ...aest(g.tip) }))
    .sort((a, b) => a.tip.localeCompare(b.tip));
  const next = (team) =>
    schedule.find(
      (g) =>
        (g.home === team || g.away === team) &&
        g.us_date > snapshot.metadata.latest_date,
    );
  return {
    ...snapshot,
    games,
    byPlayer,
    records,
    players,
    schedule,
    next,
    teamMap: new Map(snapshot.teams.map((t) => [t.team, t])),
  };
}
export function defense(model, stat) {
  const cur = model.games.filter((r) => r.season === CURRENT);
  return ["all", "G", "F", "C"].reduce((out, pos) => {
    const values = model.teams
      .map((t) => {
        const faced = cur.filter((r) => r.opp === t.team),
          gp = new Set(faced.map((r) => r.game_id)).size;
        return {
          team: t.team,
          gp,
          value: gp
            ? faced
                .filter((r) => pos === "all" || r.pos === pos)
                .reduce((a, r) => a + r[stat], 0) / gp
            : null,
        };
      })
      .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    const league = avg(
      values.filter((r) => r.value !== null),
      "value",
    );
    out[pos] = values.map((r, i) => ({
      ...r,
      rank:
        r.value === null
          ? null
          : 1 + values.filter((v) => v.value > r.value).length,
      vs_avg: r.value === null ? null : r.value - league,
    }));
    return out;
  }, {});
}
export function oddsEstimate(
  rates,
  overPrice,
  underPrice,
  weights = { l10: 0.5, szn: 0.3, prev: 0.2 },
) {
  if (!(overPrice > 1 && underPrice > 1)) throw Error("Invalid decimal odds");
  const valid = Object.entries(weights).filter(
      ([k, w]) => w > 0 && rates[k] != null,
    ),
    total = valid.reduce((n, [, w]) => n + w, 0);
  const estimated = total
    ? valid.reduce((n, [k, w]) => n + rates[k] * w, 0) / total
    : null;
  const fair = 1 / overPrice / (1 / overPrice + 1 / underPrice);
  return {
    estimated,
    fair,
    edge: estimated === null ? null : estimated - fair,
    ev: estimated === null ? null : estimated * overPrice - 1,
  };
}
