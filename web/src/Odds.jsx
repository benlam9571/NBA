import React, { useMemo, useState } from "react";
import SortTable from "./Table";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { STATS, aest } from "./model";
import { pct, fmt } from "./format";
import {
  DEFAULT_WEIGHTS,
  validateWeights,
  ODDS_DISCLAIMER,
  rankOdds,
  analyzeQuote,
  quoteState,
  quoteKey,
  movement,
  signedPct,
} from "./oddsModel";
function useNow() {
  const [now, setNow] = useState(Date.now);
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
const localTime = (t) => {
  if (!t) return "—";
  const a = aest(t);
  return `${a.date} ${a.time} AEST`;
};
const reasons = {
  unmatched_player: "球員未對應",
  ambiguous_player: "同名球員待確認",
  unmatched_event: "賽事未對應",
  non_half_line: "整數盤可能打和，暫不計 EV",
  missing_opposite_side: "缺少大／細另一邊",
  invalid_line_or_price: "盤口或賠率無效",
};
export function OddsStatus({ odds, error }) {
  return (
    <div className="odds-status">
      <span className="pill">
        {error
          ? "讀取失敗"
          : odds?.status === "connected"
            ? "已載入快照"
            : "未接駁"}
      </span>
      <small>
        {odds?.fetched_at
          ? `盤口抓取：${localTime(odds.fetched_at)}`
          : "設定後端 ODDS_API_KEY 並執行盤口抓取即可接駁。"}
        {error && ` · ${error}`}
      </small>
      {odds?.fetched_at &&
        Date.now() - Date.parse(odds.fetched_at) > 24 * 3600000 && (
          <b className="warn">盤口快照已過 24 小時</b>
        )}
      {odds?.is_fixture && <b className="warn">測試快照 · 非真實盤口</b>}
    </div>
  );
}
function WeightSettings({ weights, setWeights }) {
  const [draft, setDraft] = useState(weights);
  const invalid = !validateWeights(draft);
  return (
    <details className="weight-settings">
      <summary>估計勝率權重設定</summary>
      <p>可輸入比例，系統會正規化；缺失視窗會按比例重新分配。</p>
      <div className="weight-fields">
        {[
          ["l10", "近 10 場"],
          ["szn", "今季"],
          ["prev", "上季"],
        ].map(([k, label]) => (
          <label key={k}>
            {label}
            <input
              aria-label={label + "權重"}
              type="number"
              min="0"
              step="0.1"
              value={draft[k]}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  [k]: e.target.value === "" ? "" : +e.target.value,
                })
              }
            />
          </label>
        ))}
        <button disabled={invalid} onClick={() => setWeights(draft)}>
          套用權重
        </button>
        <button
          onClick={() => {
            setDraft(DEFAULT_WEIGHTS);
            setWeights(DEFAULT_WEIGHTS);
          }}
        >
          還原預設
        </button>
      </div>
      {invalid && <p className="warn">權重須為非負數，且至少一項大過 0。</p>}
    </details>
  );
}
export function OddsLeaderboard({
  model,
  odds,
  error,
  weights,
  setWeights,
  onSelect,
}) {
  const now = useNow();
  const [stat, setStat] = useState("all"),
    [side, setSide] = useState("over"),
    [query, setQuery] = useState("");
  const ranked = useMemo(
    () => rankOdds(model, odds, { weights, side, now }),
    [model, odds, weights, side, now],
  );
  const rows = useMemo(
    () =>
      ranked.filter(
        (r) =>
          (stat === "all" || r.stat === stat) &&
          `${r.player} ${r.team}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [ranked, stat, query],
  );
  const excluded = useMemo(
    () =>
      odds?.rows.filter(
        (q) => !q.eligible || quoteState(q, now) !== "active",
      ) || [],
    [odds, now],
  );
  const columns = [
    { key: "player", label: "球員" },
    { key: "team", label: "球隊" },
    { key: "stat", label: "項目", render: (r) => STATS[r.stat] },
    { key: "line", label: "盤口" },
    { key: "bookmaker_title", label: "最佳莊家" },
    { key: "price", label: "賠率", render: (r) => r.price.toFixed(2) },
    { key: "fair", label: "去水隱含勝率", render: (r) => pct(r.fair) },
    { key: "estimated", label: "估計勝率", render: (r) => pct(r.estimated) },
    {
      key: "edge",
      label: "Edge",
      render: (r) => signedPct(r.edge),
      className: (r) => (r.edge > 0 ? "good" : "bad"),
    },
    {
      key: "ev",
      label: "EV",
      render: (r) => signedPct(r.ev),
      className: (r) => (r.ev > 0 ? "good" : "bad"),
    },
  ];
  return (
    <>
      <div className="heading">
        <div>
          <p className="eyebrow">SPORTSBET / TAB · AU</p>
          <h1>今晚 EV 排行</h1>
          <p>同一球員、賽事、項目及盤口，比較莊家後列出最佳賠率。</p>
        </div>
        <span className="pill">{rows.length} 個可分析盤口</span>
      </div>
      <section className="panel odds-overview">
        <OddsStatus odds={odds} error={error} />
        <p className="disclaimer">{ODDS_DISCLAIMER}</p>
        <WeightSettings weights={weights} setWeights={setWeights} />
      </section>
      <section className="panel screener">
        <div className="sectionbar">
          <h2>
            盤口排行<small>預設按 EV 降序 · 點擊帶入球員分析</small>
          </h2>
          <div className="filters">
            <label>
              搜尋
              <input
                aria-label="搜尋盤口球員"
                value={query}
                placeholder="球員 / 球隊"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label>
              方向
              <select
                aria-label="盤口方向"
                value={side}
                onChange={(e) => setSide(e.target.value)}
              >
                <option value="over">大盤</option>
                <option value="under">細盤</option>
              </select>
            </label>
            <label>
              項目
              <select
                aria-label="排行項目"
                value={stat}
                onChange={(e) => setStat(e.target.value)}
              >
                <option value="all">全部項目</option>
                {Object.entries(STATS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <SortTable
          rows={rows.map((r) => ({ ...r, row_key: quoteKey(r) }))}
          columns={columns}
          initial="ev"
          onRow={onSelect}
        />
        {!rows.length && (
          <p className="odds-empty">
            {odds?.status === "connected"
              ? "未有可分析的未開波盤口；已開波、過期或未配對的報價不參與排行。"
              : "尚未載入盤口。第一期球員分析仍可照常使用。"}
          </p>
        )}
      </section>
      {(excluded.length > 0 || odds?.issues?.length > 0) && (
        <details className="panel odds-excluded">
          <summary>
            未納入排行（{excluded.length + (odds?.issues?.length || 0)}）
          </summary>
          <ul>
            {excluded.map((q, i) => (
              <li key={quoteKey(q) + "|" + i}>
                {q.player_name} · {STATS[q.stat]} {q.line} · {q.bookmaker_title}
                ：
                {reasons[q.reason] ||
                  { started: "賽事已開波", stale: "報價已過期" }[
                    quoteState(q)
                  ] ||
                  "無可用歷史數據"}
              </li>
            ))}
            {odds?.issues?.map((q, i) => (
              <li key={"issue" + i}>
                {q.player_name}：{reasons[q.reason] || q.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
function MovementChart({ series }) {
  const points = useMemo(() => {
    const buckets = new Map();
    for (const q of series) {
      const time = q.fetched_at;
      if (!buckets.has(time))
        buckets.set(time, {
          time,
          label: aest(time).date.slice(5) + " " + aest(time).time,
          values: {},
        });
      const p = buckets.get(time);
      p.values[q.bookmaker] ??= new Set();
      p.values[q.bookmaker].add(q.line);
    }
    return [...buckets.values()].map((p) => ({
      ...p,
      ...Object.fromEntries(
        Object.entries(p.values).map(([book, lines]) => [
          book,
          lines.size === 1 ? [...lines][0] : null,
        ]),
      ),
    }));
  }, [series]);
  if (points.length < 2)
    return <p className="odds-empty">累積兩次快照後會顯示走勢。</p>;
  return (
    <>
      <div className="movement-chart" role="img" aria-label="歷史盤口變動圖">
        <ResponsiveContainer>
          <LineChart
            data={points}
            margin={{ top: 15, right: 20, bottom: 5, left: -20 }}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              minTickGap={25}
              tick={{ fontSize: 10, fill: "var(--muted)" }}
            />
            <YAxis
              domain={["dataMin - 1", "dataMax + 1"]}
              tick={{ fontSize: 10, fill: "var(--muted)" }}
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                fontSize: 11,
              }}
            />
            <Line
              name="Sportsbet"
              dataKey="sportsbet"
              stroke="var(--green)"
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
            />
            <Line
              name="TAB"
              dataKey="tab"
              stroke="var(--orange)"
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <small>
        綠：Sportsbet · 橙：TAB。同一莊家同時有多個盤口時留空，詳見紀錄表。
      </small>
    </>
  );
}
export function PlayerOdds({
  model,
  odds,
  error,
  weights,
  pid,
  stat,
  line,
  onLine,
}) {
  const now = useNow();
  const quotes = useMemo(
    () =>
      (odds?.rows || [])
        .filter((q) => q.pid === pid && q.stat === stat)
        .sort(
          (a, b) =>
            a.commence_time.localeCompare(b.commence_time) ||
            a.line - b.line ||
            a.bookmaker.localeCompare(b.bookmaker),
        ),
    [odds, pid, stat],
  );
  const [event, setEvent] = useState("");
  const events = [...new Set(quotes.map((q) => q.event_id))],
    eventId = events.includes(event) ? event : events[0];
  const selected = quotes.filter((q) => q.event_id === eventId),
    series = useMemo(
      () => movement(odds, pid, stat, eventId),
      [odds, pid, stat, eventId],
    );
  return (
    <section className="panel player-odds">
      <div className="sectionbar">
        <h2>
          盤口分析<small>目前分析盤口 {line}</small>
        </h2>
        <span className="pill">Sportsbet / TAB</span>
      </div>
      <OddsStatus odds={odds} error={error} />
      {events.length > 1 && (
        <label>
          賽事
          <select
            aria-label="賠率賽事"
            value={eventId}
            onChange={(e) => setEvent(e.target.value)}
          >
            {events.map((id) => (
              <option key={id} value={id}>
                {localTime(quotes.find((q) => q.event_id === id).commence_time)}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>莊家 / 盤口</th>
                <th>大 / 細賠率</th>
                <th>大盤 EV</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {selected.map((q) => {
                const calc = analyzeQuote(model, q, weights),
                  state = quoteState(q, now);
                return (
                  <tr
                    key={quoteKey(q)}
                    className={q.analysis_line === line ? "highlight" : ""}
                  >
                    <td>
                      {q.bookmaker_title}
                      <br />
                      <small>
                        {q.line} · {localTime(q.commence_time)}
                      </small>
                    </td>
                    <td>
                      {q.over_price.toFixed(2)} / {q.under_price.toFixed(2)}
                    </td>
                    <td className={calc?.ev > 0 ? "good" : ""}>
                      {state === "active"
                        ? signedPct(calc?.ev)
                        : state === "started"
                          ? "已開波"
                          : "已過期"}
                    </td>
                    <td>
                      <button
                        disabled={!q.eligible || state !== "active"}
                        onClick={() => onLine(q.analysis_line)}
                      >
                        分析 {q.line}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="odds-empty">
          {odds?.status === "connected"
            ? "呢位球員／項目暫無可用盤口。"
            : "盤口尚未接駁。"}
        </p>
      )}
      <details className="movement">
        <summary>盤口變動紀錄（{series.length} 筆）</summary>
        <MovementChart series={series} />
        {series.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>抓取時間 AEST</th>
                  <th>莊家</th>
                  <th>盤口</th>
                  <th>大 / 細賠率</th>
                </tr>
              </thead>
              <tbody>
                {series.map((q, i) => (
                  <tr key={quoteKey(q) + "|" + q.fetched_at + "|" + i}>
                    <td>{localTime(q.fetched_at)}</td>
                    <td>{q.bookmaker_title}</td>
                    <td>{q.line}</td>
                    <td>
                      {q.over_price.toFixed(2)} / {q.under_price.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="odds-empty">暫無歷史快照。</p>
        )}
      </details>
      <small className="disclaimer">{ODDS_DISCLAIMER}</small>
    </section>
  );
}
