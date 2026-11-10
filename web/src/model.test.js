import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLine,
  defaultLine,
  summary,
  createModel,
  defense,
  aest,
  oddsEstimate,
} from "./model.js";
const game = (i, extra = {}) => ({
  pid: "1",
  player: "Tester",
  team: "LAL",
  opp: "DET",
  game_id: String(i),
  date: `2026-10-${String(i).padStart(2, "0")}`,
  season: "2026-27",
  pos: "G",
  ha: "H",
  wl: "W",
  min: 30,
  pts: i,
  reb: 3,
  ast: 5,
  fg3m: 2,
  stl: 1,
  blk: 2,
  tov: 1,
  ...extra,
});
test("half-point normalization accepts negative, integer and invalid inputs", () => {
  assert.equal(normalizeLine(30), 30.5);
  assert.equal(normalizeLine(-5), 0.5);
  assert.equal(normalizeLine(NaN), 0.5);
  assert.equal(normalizeLine(35.5), 35.5);
});
test("rolling windows span seasons, sort same-day IDs, and retain text IDs", () => {
  const m = createModel({
    metadata: { latest_date: "2026-10-10" },
    teams: [{ team: "LAL" }, { team: "DET" }],
    schedule: [],
    games: [
      game(1, { season: "2025-26" }),
      game(2),
      game(3, { date: "2026-10-02" }),
    ],
  });
  const g = m.byPlayer.get("1");
  assert.equal(g[0].game_id, "3");
  assert.equal(defaultLine(g, "pts"), 2.5);
  const s = summary(g, "pts", 1.5);
  assert.equal(s.l5.n, 3);
  assert.equal(s.l5.over, 2);
  assert.equal(s.szn.n, 2);
  assert.equal(s.away.rate, null);
  assert.equal(g[0].pra, 11);
  assert.equal(g[0].stk, 3);
});
test("Brisbane conversion handles US offset across midnight", () =>
  assert.deepEqual(aest("2026-11-08T18:00:00-05:00"), {
    date: "2026-11-09",
    time: "09:00",
  }));
test("defense denominator counts team games, not players or positional appearances", () => {
  const m = createModel({
    metadata: { latest_date: "2026-10-02" },
    teams: [{ team: "LAL" }, { team: "DET" }],
    schedule: [],
    games: [
      game(1),
      game(1, { pid: "2", pos: "F", pts: 20 }),
      game(2, { pid: "3", pos: "F", pts: 10 }),
    ],
  });
  const d = defense(m, "pts");
  assert.equal(d.G.find((r) => r.team === "DET").value, 0.5);
  assert.equal(d.all.find((r) => r.team === "DET").value, 15.5);
  assert.equal(d.G.find((r) => r.team === "DET").rank, 1);
});
test("team standings deduplicate player rows; next game uses US game date", () => {
  const m = createModel({
    metadata: { latest_date: "2026-10-01" },
    teams: [{ team: "LAL" }, { team: "DET" }],
    games: [game(1), game(1, { pid: "2" })],
    schedule: [
      {
        date: "2026-10-01",
        tip: "2026-10-02T01:00:00Z",
        home: "LAL",
        away: "DET",
      },
      {
        date: "2026-10-02",
        tip: "2026-10-03T01:00:00Z",
        home: "DET",
        away: "LAL",
      },
    ],
  });
  assert.equal(m.records.get("LAL").w, 1);
  assert.equal(m.next("LAL").us_date, "2026-10-02");
});
test("odds de-vig and missing-window weight redistribution", () => {
  const o = oddsEstimate({ l10: 0.7, szn: 0.6, prev: null }, 2, 2);
  assert.equal(o.fair, 0.5);
  assert.ok(Math.abs(o.estimated - 0.6625) < 1e-10);
  assert.ok(Math.abs(o.ev - 0.325) < 1e-10);
  assert.equal(oddsEstimate({}, 2, 2).estimated, null);
  assert.throws(() => oddsEstimate({}, 0, 2));
});
