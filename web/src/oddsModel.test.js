import test from "node:test";
import assert from "node:assert/strict";
import { createModel } from "./model.js";
import {
  validateOdds,
  rankOdds,
  analyzeQuote,
  quoteState,
  movement,
  validateWeights,
} from "./oddsModel.js";
const NOW = Date.parse("2026-11-10T00:00:00Z");
const model = createModel({
  metadata: { latest_date: "2026-11-09" },
  teams: [{ team: "LAL" }, { team: "DET" }],
  schedule: [],
  games: [10, 20, 30, 40, 50].map((pts, i) => ({
    pid: "1",
    player: "Test Player",
    pos: "G",
    team: "LAL",
    opp: "DET",
    season: i === 0 ? "2025-26" : "2026-27",
    date: `2026-11-0${i + 1}`,
    game_id: String(i),
    ha: "H",
    wl: "W",
    pts,
    min: 30,
    reb: 3,
    ast: 4,
    fg3m: 2,
    stl: 1,
    blk: 1,
    tov: 1,
  })),
});
const quote = (extra = {}) => ({
  event_id: "event",
  game_id: "game",
  pid: "1",
  player_name: "Test Player",
  bookmaker: "sportsbet",
  bookmaker_title: "Sportsbet",
  market: "player_points",
  stat: "pts",
  line: 25.5,
  analysis_line: 25.5,
  eligible: true,
  over_price: 2,
  under_price: 2,
  fetched_at: "2026-11-09T23:00:00Z",
  updated_at: "2026-11-09T23:00:00Z",
  commence_time: "2026-11-10T04:00:00Z",
  ...extra,
});
const bundle = (rows) => ({
  schema_version: 1,
  status: "connected",
  fetched_at: "2026-11-09T23:00:00Z",
  rows,
  history: [],
});
test("schema rejects malformed data instead of displaying NaN estimates", () => {
  assert.equal(validateOdds(bundle([quote()])).rows.length, 1);
  assert.throws(() => validateOdds(bundle([quote({ over_price: NaN })])));
  assert.throws(() =>
    validateOdds(bundle([quote({ market: "unknown", stat: undefined })])),
  );
  assert.throws(() => validateOdds({ schema_version: 99, rows: [] }));
  assert.equal(validateWeights({ l10: 0, szn: 0, prev: 0 }), false);
  assert.equal(validateWeights({ l10: 1, szn: -1, prev: 1 }), false);
});
test("de-vig, weighted estimates, edge and EV use the selected bookmaker pair", () => {
  const r = analyzeQuote(model, quote());
  assert.equal(r.fair, 0.5);
  assert.ok(Math.abs(r.estimated - 0.525) < 1e-10);
  assert.ok(Math.abs(r.ev - 0.05) < 1e-10);
  assert.ok(Math.abs(r.edge - 0.025) < 1e-10);
  const under = analyzeQuote(model, quote(), undefined, "under");
  assert.ok(Math.abs(under.estimated - 0.475) < 1e-10);
  assert.ok(Math.abs(under.ev + 0.05) < 1e-10);
  assert.deepEqual(r.samples, { l10: 5, szn: 4, prev: 1 });
});
test("best price grouped by event, player, market and line; never mix prices", () => {
  const rows = [
    quote(),
    quote({
      bookmaker: "tab",
      bookmaker_title: "TAB",
      over_price: 2.2,
      under_price: 1.7,
    }),
    quote({ line: 35.5, analysis_line: 35.5 }),
    quote({ event_id: "other" }),
  ];
  const ranked = rankOdds(model, bundle(rows), { now: NOW });
  assert.equal(ranked.length, 3);
  assert.equal(
    ranked.find((r) => r.event_id === "event" && r.line === 25.5).bookmaker,
    "tab",
  );
  assert.equal(
    ranked.find((r) => r.bookmaker === "tab").fair,
    1 / 2.2 / (1 / 2.2 + 1 / 1.7),
  );
  assert.equal(
    rankOdds(model, bundle(rows), { side: "under", now: NOW }).find(
      (r) => r.event_id === "event" && r.line === 25.5,
    ).bookmaker,
    "sportsbet",
  );
});
test("started, stale, unmatched and integer quotes never enter EV ranking", () => {
  const stale = quote({ fetched_at: "2026-11-08T00:00:00Z" });
  assert.equal(quoteState(stale, NOW), "stale");
  assert.equal(
    quoteState(quote({ commence_time: "2026-11-09T00:00:00Z" }), NOW),
    "started",
  );
  const invalid = [
    stale,
    quote({ commence_time: "2026-11-09T00:00:00Z" }),
    quote({ eligible: false }),
    quote({ pid: "missing" }),
    quote({ line: 30, analysis_line: 30.5 }),
  ];
  assert.deepEqual(rankOdds(model, bundle(invalid), { now: NOW }), []);
});
test("history stays within selected event and de-duplicates snapshots", () => {
  const q = quote(),
    data = {
      ...bundle([q]),
      history: [
        q,
        quote({ event_id: "other" }),
        quote({ fetched_at: "2026-11-09T22:00:00Z", line: 24.5 }),
      ],
    };
  assert.equal(movement(data, "1", "pts", "event").length, 2);
  assert.equal(movement(data, "1", "reb", "event").length, 0);
});
