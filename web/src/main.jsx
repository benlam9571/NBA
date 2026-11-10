import React, { useState, useMemo, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  Activity,
  Search,
} from "lucide-react";
import {
  CURRENT,
  STATS,
  WINDOWS,
  createModel,
  summary,
  windows,
  avg,
  defaultLine,
  normalizeLine,
  aest,
  defense,
} from "./model";
import "./style.css";
import SortTable from "./Table";
import { fmt } from "./format";
import {
  initialWeights,
  validateWeights,
  validateOdds,
  quoteState,
} from "./oddsModel";
const OddsLeaderboard = React.lazy(() =>
  import("./Odds").then((m) => ({ default: m.OddsLeaderboard })),
);
const PlayerView = React.lazy(() => import("./PlayerView"));
const route = () => {
  const p = location.hash.slice(1).split("/");
  return {
    page: p[0] || "teams",
    id: decodeURIComponent(p[1] || ""),
    stat: p[2] || null,
    oddsLine: p[3] || null,
  };
};
const ModelContext = React.createContext(null);
function Badge({ code, large = false }) {
  const model = React.useContext(ModelContext);
  const t = model?.teamMap.get(code),
    hex = t?.color || "#24493e";
  const rgb = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((x) => {
      let c = parseInt(x, 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) || [0, 0, 0];
  const lum = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return (
    <span
      className={"badge " + (large ? "large" : "")}
      style={{
        background: hex,
        color: lum > 0.6 ? "#152526" : "white",
        borderBottomColor: t?.alternate,
      }}
    >
      {code}
    </span>
  );
}
function App() {
  const [model, setModel] = useState(null),
    [error, setError] = useState(""),
    [odds, setOdds] = useState(null),
    [oddsError, setOddsError] = useState(""),
    [weights, setWeightState] = useState(initialWeights),
    [r, setRoute] = useState(route),
    [stat, setStat] = useState("pts"),
    [line, setLine] = useState(0.5),
    [dark, setDark] = useState(localStorage.getItem("theme") === "dark");
  useEffect(() => {
    fetch(import.meta.env.BASE_URL + "snapshot.json")
      .then((r) => {
        if (!r.ok) throw Error("未有數據，請先執行 ETL。");
        return r.json();
      })
      .then((x) => setModel(createModel(x)))
      .catch((e) => setError(e.message));
    const f = () => setRoute(route());
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(import.meta.env.BASE_URL + "odds.json", { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404)
          return {
            schema_version: 1,
            status: "disconnected",
            rows: [],
            history: [],
          };
        if (!response.ok) throw Error("無法讀取盤口快照");
        return validateOdds(await response.json());
      })
      .then(setOdds)
      .catch((e) => {
        if (e.name !== "AbortError") setOddsError(e.message);
      });
    return () => controller.abort();
  }, []);
  const setWeights = (value) => {
    if (validateWeights(value)) {
      setWeightState(value);
      try {
        localStorage.setItem("nba-odds-weights", JSON.stringify(value));
      } catch {}
    }
  };
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  const player = model?.byPlayer.get(r.id),
    team = r.page === "team" ? r.id : player?.[0].team;
  useEffect(() => {
    if (player) {
      if (r.stat && STATS[r.stat] && r.stat !== stat) {
        setStat(r.stat);
        return;
      }
      setLine(
        r.stat === stat && r.oddsLine !== null && Number.isFinite(+r.oddsLine)
          ? normalizeLine(r.oddsLine)
          : defaultLine(player, stat),
      );
    }
  }, [player, stat, r.id, r.stat, r.oddsLine]);
  const go = (page, id = "") => {
    location.hash = page + (id ? "/" + encodeURIComponent(id) : "");
  };

  const rec = (code) => {
    const v = model.records.get(code);
    return `${v?.w ?? 0} 勝 ${v?.l ?? 0} 負`;
  };
  const nextText = (code) => {
    const g = model.next(code);
    return g
      ? `${aest(g.tip).date.slice(5)} ${g.home === code ? "主場 vs" : "作客 @"} ${g.home === code ? g.away : g.home}`
      : "暫無未來賽程";
  };
  const selector = (
    <label>
      分析項目
      <select
        aria-label="分析項目"
        value={stat}
        onChange={(e) => {
          if (r.page === "player" && r.stat)
            history.replaceState(null, "", "#player/" + r.id);
          setRoute(route());
          setStat(e.target.value);
        }}
      >
        {Object.entries(STATS).map(([k, v]) => (
          <option key={k} value={k}>
            {v} · {k.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <ModelContext.Provider value={model}>
      <>
        <header>
          <a className="brand" href="#teams">
            <Activity size={28} /> NBA <span>/ PROPS</span>
          </a>
          <span className="headernote">球員數據分析</span>
          <a
            className={r.page === "odds" ? "nav-odds active" : "nav-odds"}
            href="#odds"
          >
            今晚 EV 排行
          </a>
          <button
            className="icon"
            aria-label="切換深淡色"
            onClick={() => setDark(!dark)}
          >
            {dark ? <Sun /> : <Moon />}
          </button>
        </header>
        <main>
          <nav>
            <a href="#teams">全部球隊</a>
            {team && (
              <>
                <ChevronRight size={14} />
                <a href={"#team/" + team}>
                  {model.teamMap.get(team)?.name || team}
                </a>
              </>
            )}
            {player && (
              <>
                <ChevronRight size={14} />
                <span>{player[0].player}</span>
              </>
            )}
          </nav>
          {error ? (
            <section className="panel empty">
              <h1>數據未就緒</h1>
              <p>{error}</p>
              <code>PYTHON=.venv/bin/python bash etl/fetch.sh</code>
              <button onClick={() => location.reload()}>重新載入</button>
            </section>
          ) : !model ? (
            <p role="status" className="empty">
              正在載入兩季球員數據…
            </p>
          ) : (
            <>
              <Slate model={model} go={go} Badge={Badge} rec={rec} />
              <div className="data-note">
                數據截至 {model.metadata.latest_date} · 2026–27 常規賽{" "}
                <span>時間：布里斯本 AEST（UTC+10）</span>
                {Date.now() -
                  Date.parse(model.metadata.latest_date + "T23:59:59-05:00") >
                  48 * 3600000 && (
                  <b className="warn">數據已超過 48 小時，等候更新</b>
                )}
              </div>
              {r.page === "odds" ? (
                <React.Suspense
                  fallback={<p role="status">正在載入盤口分析…</p>}
                >
                  <OddsLeaderboard
                    model={model}
                    odds={odds}
                    error={oddsError}
                    weights={weights}
                    setWeights={setWeights}
                    onSelect={(q) => {
                      location.hash = `player/${q.pid}/${q.stat}/${q.analysis_line}`;
                    }}
                  />
                </React.Suspense>
              ) : r.page === "teams" ? (
                <>
                  <div className="heading">
                    <div>
                      <p className="eyebrow">聯盟概覽</p>
                      <h1>全部球隊</h1>
                      <p>由球隊出發，搵出球員近況。</p>
                    </div>
                    <span className="pill">30 隊 · 6 個分區</span>
                  </div>
                  <div className="conferences">
                    {["東岸", "西岸"].map((conf) => (
                      <section key={conf}>
                        <h2>
                          {conf}
                          <small>
                            {conf === "東岸" ? "EASTERN" : "WESTERN"} CONFERENCE
                          </small>
                        </h2>
                        {[
                          ...new Set(
                            model.teams
                              .filter((t) => t.conference === conf)
                              .map((t) => t.division),
                          ),
                        ].map((div) => (
                          <div className="panel division" key={div}>
                            <h3>{div}分區</h3>
                            {model.teams
                              .filter((t) => t.division === div)
                              .sort((a, b) => {
                                const x = model.records.get(a.team),
                                  y = model.records.get(b.team);
                                return (
                                  y.w - x.w ||
                                  x.l - y.l ||
                                  a.team.localeCompare(b.team)
                                );
                              })
                              .map((t) => (
                                <button
                                  className="team-row"
                                  key={t.team}
                                  onClick={() => go("team", t.team)}
                                >
                                  <Badge code={t.team} />
                                  <span className="grow">
                                    <strong>{t.name}</strong>
                                    <small>{nextText(t.team)}</small>
                                  </span>
                                  <span className="record">{rec(t.team)}</span>
                                  <ChevronRight size={16} />
                                </button>
                              ))}
                          </div>
                        ))}
                      </section>
                    ))}
                  </div>
                  <PlayerTable
                    model={model}
                    stat={stat}
                    selector={selector}
                    go={go}
                  />
                </>
              ) : r.page === "team" && model.teamMap.has(team) ? (
                <>
                  <div className="heading team-heading">
                    <Badge code={team} large />
                    <div className="grow">
                      <p className="eyebrow">
                        {model.teamMap.get(team).conference} ·{" "}
                        {model.teamMap.get(team).division}分區
                      </p>
                      <h1>{model.teamMap.get(team).name}</h1>
                      <p>
                        {rec(team)} · 下一場 {nextText(team)}
                      </p>
                    </div>
                    {selector}
                  </div>
                  <h2>
                    球隊陣容<small>按近 5 場上場時間排序</small>
                  </h2>
                  <div className="roster">
                    {model.players
                      .filter((p) => p.team === team)
                      .sort(
                        (a, b) =>
                          avg(b.games.slice(0, 5), "min") -
                          avg(a.games.slice(0, 5), "min"),
                      )
                      .map((p) => {
                        const w = windows(p.games),
                          a = avg(w.l5, stat),
                          b = avg(w.szn, stat),
                          diff = a - b;
                        return (
                          <button
                            className="panel player-card"
                            key={p.pid}
                            onClick={() => go("player", p.pid)}
                          >
                            <div className="card-top">
                              <span className="initials">
                                {p.player
                                  .split(" ")
                                  .map((s) => s[0])
                                  .slice(0, 2)
                                  .join("")}
                              </span>
                              <div>
                                <h3>{p.player}</h3>
                                <small>
                                  {p.pos} · {w.szn.length} 場 · 近 5 場{" "}
                                  {fmt(avg(w.l5, "min"))} MIN
                                </small>
                              </div>
                              <ChevronRight size={18} />
                            </div>
                            <div className="four">
                              {[
                                ["今季", b],
                                ["近 5 場", a],
                                ["差距", diff],
                                ["上季", avg(w.prev, stat)],
                              ].map(([label, n]) => (
                                <div key={label}>
                                  <small>{label}</small>
                                  <strong
                                    className={
                                      label === "差距"
                                        ? diff >= 1
                                          ? "good"
                                          : diff <= -1
                                            ? "bad"
                                            : ""
                                        : ""
                                    }
                                  >
                                    {label === "差距" && diff > 0 ? "+" : ""}
                                    {fmt(n)}
                                  </strong>
                                </div>
                              ))}
                            </div>
                            {avg(w.l5, "min") < avg(w.szn, "min") - 4 && (
                              <p className="warn">上場時間跌緊</p>
                            )}
                            <div className="odds-inline">
                              今晚盤口{" "}
                              <span>
                                {(() => {
                                  const q = odds?.rows.find(
                                    (q) =>
                                      q.pid === p.pid &&
                                      q.stat === stat &&
                                      q.eligible &&
                                      quoteState(q) === "active",
                                  );
                                  return q
                                    ? `${q.bookmaker_title} ${q.line} · 大 ${q.over_price.toFixed(2)}`
                                    : odds?.status === "connected"
                                      ? "暫無報價"
                                      : "未接駁";
                                })()}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </>
              ) : r.page === "player" && player ? (
                <React.Suspense
                  fallback={<p role="status">正在載入球員分析…</p>}
                >
                  <PlayerView
                    model={model}
                    odds={odds}
                    oddsError={oddsError}
                    weights={weights}
                    games={player}
                    stat={stat}
                    line={line}
                    setLine={setLine}
                    selector={selector}
                    go={go}
                    Badge={Badge}
                  />
                </React.Suspense>
              ) : (
                <section className="panel empty">
                  <h1>搵唔到呢個頁面</h1>
                  <a href="#teams">返回全部球隊</a>
                </section>
              )}
              <footer>
                公開 ESPN box score · sportsdataverse /
                hoopR　｜　歷史表現只供個人分析，未計傷病與上陣時間變動。
              </footer>
            </>
          )}
        </main>
      </>
    </ModelContext.Provider>
  );
}
function Slate({ model, go, Badge, rec }) {
  const days = [...new Set(model.schedule.map((g) => g.date))],
    today = aest(new Date().toISOString()).date;
  const [day, setDay] = useState(days.find((d) => d >= today) || days[0]);
  const idx = days.indexOf(day);
  return (
    <section className="slate panel">
      <div className="sectionbar">
        <h2>
          每日賽程 <small>AEST</small>
        </h2>
        <div className="day-control">
          <button
            aria-label="上一個比賽日"
            disabled={idx <= 0}
            onClick={() => setDay(days[idx - 1])}
          >
            <ChevronLeft size={16} />
          </button>
          <strong>{day || "暫無賽程"}</strong>
          <button
            aria-label="下一個比賽日"
            disabled={idx < 0 || idx >= days.length - 1}
            onClick={() => setDay(days[idx + 1])}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="slate-track">
        {model.schedule
          .filter((g) => g.date === day)
          .map((g) => (
            <article className="game" key={g.game_id}>
              <small>
                {g.time} <span>開波</span>
              </small>
              {[g.away, g.home].map((code, i) => (
                <button key={code} onClick={() => go("team", code)}>
                  <Badge code={code} />
                  <strong>{model.teamMap.get(code)?.short || code}</strong>
                  <small>{rec(code)}</small>
                  <em>{i ? "主" : "客"}</em>
                </button>
              ))}
            </article>
          ))}
      </div>
    </section>
  );
}
function PlayerTable({ model, stat, selector, go }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () =>
      model.players
        .map((p) => {
          const w = windows(p.games);
          return {
            ...p,
            gp: w.szn.length,
            szn: avg(w.szn, stat),
            l5: avg(w.l5, stat),
            diff: avg(w.l5, stat) - avg(w.szn, stat),
            prev: avg(w.prev, stat),
            l5_min: avg(w.l5, "min"),
            szn_min: avg(w.szn, "min"),
          };
        })
        .filter(
          (p) =>
            p.gp >= 3 &&
            `${p.player} ${p.team} ${model.teamMap.get(p.team)?.name}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        ),
    [model, stat, query],
  );
  return (
    <section className="panel screener">
      <div className="sectionbar">
        <div>
          <h2>球員篩選</h2>
          <small>今季至少 3 場 · {rows.length} 位球員</small>
        </div>
        <div className="filters">
          <label className="search">
            <Search size={16} />
            <input
              aria-label="搜尋球員或球隊"
              placeholder="搜尋球員 / 球隊"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {selector}
        </div>
      </div>
      <SortTable
        rows={rows}
        onRow={(p) => go("player", p.pid)}
        columns={[
          { key: "player", label: "球員" },
          { key: "team", label: "球隊" },
          { key: "pos", label: "位置" },
          { key: "gp", label: "場數" },
          ...["szn", "l5", "diff", "prev", "l5_min", "szn_min"].map((k, i) => ({
            key: k,
            label: [
              "今季平均",
              "近 5 場",
              "差距",
              "上季平均",
              "近 5 場 MIN",
              "今季 MIN",
            ][i],
            render: (r) => (k === "diff" && r[k] > 0 ? "+" : "") + fmt(r[k]),
            className: (r) =>
              k === "diff"
                ? r[k] >= 1
                  ? "good"
                  : r[k] <= -1
                    ? "bad"
                    : ""
                : "",
          })),
        ]}
      />
    </section>
  );
}
createRoot(document.getElementById("root")).render(<App />);
