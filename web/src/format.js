const fmt = (n) => (n == null ? "—" : n.toFixed(1)),
  pct = (n) => (n == null ? "—" : Math.round(n * 100) + "%"),
  tone = (n) => (n == null ? "" : n >= 0.6 ? "good" : n <= 0.4 ? "bad" : "");

export { fmt, pct, tone };
