import React, { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
} from "recharts";
import {
  STATS,
  WINDOWS,
  windows,
  summary,
  defense,
  avg,
  aest,
  normalizeLine,
  defaultLine,
} from "./model";
import SortTable from "./Table";
import { PlayerOdds } from "./Odds";
import { fmt, pct, tone } from "./format";
function PlayerView({
  model,
  odds,
  oddsError,
  weights,
  games,
  stat,
  line,
  setLine,
  selector,
  go,
  Badge,
}) {
  const deferredLine = React.useDeferredValue(line);
  const p = games[0],
    w = useMemo(() => windows(games), [games]),
    s = useMemo(() => summary(games, stat, line), [games, stat, line]);
  const max = Math.max(...games.map((g) => g[stat])) + 0.5;
  return (
    <>
      <div className="heading team-heading">
        <Badge code={p.team} large />
        <div className="grow">
          <p className="eyebrow">
            {model.teamMap.get(p.team)?.name} · {p.pos} · 今季 {w.szn.length} 場
          </p>
          <h1>{p.player}</h1>
          <p>
            {p.player} 近 10 場{STATS[stat]}有 {s.l10.over} 場大過 {line}（
            {s.l10.over}/{s.l10.n}），今季平均 {fmt(s.szn.avg)}，上場時間近 5 場{" "}
            {fmt(avg(w.l5, "min"))} 分鐘。
          </p>
        </div>
      </div>
      <section className="panel controls">
        <label>
          球員
          <select
            aria-label="球員"
            value={p.pid}
            onChange={(e) => go("player", e.target.value)}
          >
            {model.teams.map((t) => (
              <optgroup key={t.team} label={t.name}>
                {model.players
                  .filter((p) => p.team === t.team)
                  .sort((a, b) => a.player.localeCompare(b.player))
                  .map((p) => (
                    <option key={p.pid} value={p.pid}>
                      {p.player}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        {selector}
        <label>
          盤口
          <div className="stepper">
            <button
              aria-label="減少盤口"
              onClick={() => setLine(normalizeLine(line - 1))}
            >
              −
            </button>
            <input
              aria-label="盤口"
              type="number"
              min="0.5"
              step="1"
              value={line}
              onChange={(e) => setLine(normalizeLine(e.target.value))}
            />
            <button
              aria-label="增加盤口"
              onClick={() => setLine(normalizeLine(line + 1))}
            >
              ＋
            </button>
          </div>
        </label>
        <div className="slider">
          <label htmlFor="line-range">
            調整盤口 <strong>{line}</strong>
          </label>
          <input
            id="line-range"
            aria-label="盤口拉桿"
            type="range"
            min="0.5"
            max={Math.max(max, line)}
            step="1"
            value={line}
            onChange={(e) => setLine(+e.target.value)}
          />
          <button
            className="text-button"
            onClick={() => setLine(defaultLine(games, stat))}
          >
            按近 10 場平均重設
          </button>
        </div>
      </section>
      <AnalysisBody
        model={model}
        odds={odds}
        oddsError={oddsError}
        weights={weights}
        onLine={setLine}
        games={games}
        stat={stat}
        line={deferredLine}
        Badge={Badge}
      />
    </>
  );
}
const AnalysisBody = React.memo(function AnalysisBody({
  model,
  odds,
  oddsError,
  weights,
  onLine,
  games,
  stat,
  line,
  Badge,
}) {
  const [count, setCount] = useState(20),
    [group, setGroup] = useState("all");
  const p = games[0],
    w = useMemo(() => windows(games), [games]),
    s = useMemo(() => summary(games, stat, line), [games, stat, line]),
    def = useMemo(() => defense(model, stat), [model, stat]);
  const max = Math.max(...games.map((g) => g[stat])) + 0.5,
    chart = games
      .slice(0, count)
      .reverse()
      .map((g) => ({ ...g, label: g.date.slice(5) + " " + g.opp })),
    next = model.next(p.team),
    opp = next ? (next.home === p.team ? next.away : next.home) : null,
    oppDef = def[p.pos]?.find((d) => d.team === opp),
    split = chart.find((g, i) => i > 0 && g.season !== chart[i - 1].season);
  const gameCols = [
    { key: "date", label: "日期" },
    { key: "season", label: "球季" },
    { key: "opp", label: "對手" },
    { key: "ha", label: "主客" },
    { key: "wl", label: "勝負" },
    { key: "start", label: "正選", render: (r) => (r.start ? "正選" : "後備") },
    ...[
      "min",
      "pts",
      "reb",
      "ast",
      "fg3m",
      "stl",
      "blk",
      "tov",
      ...(!["pts", "reb", "ast", "fg3m", "stl", "blk", "tov"].includes(stat)
        ? [stat]
        : []),
    ].map((k) => ({
      key: k,
      label: k.toUpperCase(),
      className: (r) => (k === stat ? (r[k] > line ? "good" : "bad") : ""),
    })),
  ];
  return (
    <>
      {" "}
      <div className="rates">
        {Object.entries(WINDOWS).map(([k, label]) => (
          <section className="panel rate" key={k}>
            <h3>{label}</h3>
            <strong className={tone(s[k].rate)}>{pct(s[k].rate)}</strong>
            <small>
              {s[k].over} / {s[k].n} 場過盤 · 平均 {fmt(s[k].avg)}
            </small>
          </section>
        ))}
      </div>
      <div className="analysis-grid">
        <section className="panel chart-panel">
          <div className="sectionbar">
            <h2>
              逐場{STATS[stat]}
              <small>
                {stat.toUpperCase()} · 大過 {line} 為過盤
              </small>
            </h2>
            <select
              aria-label="圖表場數"
              value={count}
              onChange={(e) => setCount(+e.target.value)}
            >
              {[10, 20, 40].map((n) => (
                <option key={n} value={n}>
                  近 {n} 場
                </option>
              ))}
            </select>
          </div>
          <div
            className="chart"
            role="img"
            aria-label={`近 ${count} 場${STATS[stat]}柱狀圖，盤口 ${line}`}
          >
            <ResponsiveContainer>
              <BarChart
                data={chart}
                margin={{ top: 20, right: 15, bottom: 25, left: -25 }}
              >
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                  minTickGap={22}
                />
                <YAxis
                  domain={[0, Math.max(max, line) + 3]}
                  tick={{ fontSize: 11, fill: "var(--muted)" }}
                />
                <Tooltip content={<GameTooltip stat={stat} />} />
                <ReferenceLine
                  y={line}
                  stroke="var(--ink)"
                  strokeDasharray="5 4"
                  label={{
                    value: `盤口 ${line}`,
                    position: "insideTopRight",
                    fill: "var(--ink)",
                    fontSize: 11,
                  }}
                />
                {split && (
                  <ReferenceLine
                    x={split.label}
                    stroke="var(--muted)"
                    strokeDasharray="3 3"
                    label="今季"
                  />
                )}
                <Bar
                  dataKey={stat}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                >
                  {chart.map((g) => (
                    <Cell
                      key={g.game_id}
                      fill={g[stat] > line ? "var(--green)" : "var(--pale)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <small>
            由左至右：舊 → 新；懸停查看日期、對手、勝負、數值及分鐘。
          </small>
        </section>
        <section className="panel opponent">
          <p className="eyebrow">下一場對手</p>
          {opp ? (
            <>
              <div className="card-top">
                <Badge code={opp} large />
                <div>
                  <h2>{model.teamMap.get(opp)?.short}</h2>
                  <small>
                    {aest(next.tip).date} · {aest(next.tip).time} AEST
                  </small>
                </div>
              </div>
              <p>
                對手 {opp} 今季每場畀 {p.pos} 位置球員攞{" "}
                <strong>
                  {fmt(oppDef?.value)} {STATS[stat]}
                </strong>
                ，30 隊中排第 <strong>{oppDef?.rank ?? "—"}</strong>{" "}
                多（比聯盟平均 {oppDef?.vs_avg > 0 ? "+" : ""}
                {fmt(oppDef?.vs_avg)}）。
              </p>
              <h3>兩季對賽往績</h3>
              <SortTable
                rows={games.filter((g) => g.opp === opp)}
                initial="date"
                columns={[
                  { key: "date", label: "日期" },
                  { key: stat, label: stat.toUpperCase() },
                  { key: "min", label: "MIN" },
                ]}
              />
            </>
          ) : (
            <p>暫無下一場賽程。</p>
          )}
        </section>
        <section className="panel chart-panel">
          <h2>
            上場時間<small>虛線：今季平均 {fmt(avg(w.szn, "min"))} MIN</small>
          </h2>
          <div className="chart minutes">
            <ResponsiveContainer>
              <LineChart
                data={chart}
                margin={{ top: 20, right: 15, bottom: 20, left: -25 }}
              >
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                  minTickGap={22}
                />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <Tooltip content={<GameTooltip stat="min" />} />
                <ReferenceLine
                  y={avg(w.szn, "min")}
                  stroke="var(--muted)"
                  strokeDasharray="4 4"
                />
                <Line
                  dataKey="min"
                  stroke="var(--green)"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
        <PlayerOdds
          model={model}
          odds={odds}
          error={oddsError}
          weights={weights}
          pid={p.pid}
          stat={stat}
          line={line}
          onLine={onLine}
        />
      </div>
      <section className="panel screener">
        <div className="sectionbar">
          <h2>
            各隊防守<small>1 = 容許最多 · 最好打</small>
          </h2>
          <label>
            對手位置
            <select
              aria-label="防守位置"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            >
              {["all", "G", "F", "C"].map((x) => (
                <option key={x} value={x}>
                  {x === "all" ? "全部位置" : x}
                </option>
              ))}
            </select>
          </label>
        </div>
        <SortTable
          rows={def[group]}
          initial="value"
          highlight={opp}
          columns={[
            { key: "team", label: "球隊" },
            { key: "gp", label: "場數" },
            { key: "rank", label: "排名" },
            {
              key: "value",
              label: `每場容許 ${stat.toUpperCase()}`,
              render: (r) => fmt(r.value),
            },
            {
              key: "vs_avg",
              label: "與聯盟平均差",
              render: (r) => (r.vs_avg > 0 ? "+" : "") + fmt(r.vs_avg),
            },
          ]}
        />
      </section>
      <section className="panel screener">
        <div className="sectionbar">
          <h2>
            逐場紀錄
            <small>
              兩季共 {games.length} 場 · 今季中位數{" "}
              {fmt(
                [...w.szn].sort((a, b) => a[stat] - b[stat]).length
                  ? median(w.szn.map((g) => g[stat]))
                  : null,
              )}
            </small>
          </h2>
        </div>
        <SortTable rows={games} columns={gameCols} initial="date" />
      </section>
    </>
  );
});
function median(a) {
  a.sort((x, y) => x - y);
  return a.length % 2
    ? a[(a.length - 1) / 2]
    : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
}
function GameTooltip({ active, payload, stat }) {
  if (!active || !payload?.length) return null;
  const g = payload[0].payload;
  return (
    <div className="tooltip">
      <strong>
        {g.date} · {g.ha === "H" ? "vs" : "@"} {g.opp} ·{" "}
        {g.wl === "W" ? "勝" : "負"}
      </strong>
      <p>
        {stat.toUpperCase()}：{g[stat]} · {g.min} MIN
      </p>
      <small>
        {g.start ? "正選" : "後備"} · {g.season}
      </small>
    </div>
  );
}

export default PlayerView;
