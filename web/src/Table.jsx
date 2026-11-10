import React, { useState, useMemo } from "react";
import { ArrowUpDown } from "lucide-react";
export default function SortTable({
  columns,
  rows,
  onRow,
  initial = "diff",
  highlight,
}) {
  const [sort, setSort] = useState({ key: initial, dir: -1 });
  const ordered = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const x = a[sort.key],
          y = b[sort.key];
        if (x == null) return 1;
        if (y == null) return -1;
        return (
          sort.dir *
          (typeof x === "number" ? x - y : String(x).localeCompare(String(y)))
        );
      }),
    [rows, sort],
  );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>
                <button
                  onClick={() =>
                    setSort({
                      key: c.key,
                      dir: sort.key === c.key ? -sort.dir : 1,
                    })
                  }
                >
                  {c.label}
                  <ArrowUpDown size={11} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((r, i) => (
            <tr
              key={
                r.row_key ||
                (r.game_id ? `${r.game_id}|${r.pid}` : r.pid || r.team || i)
              }
              className={
                (onRow ? "clickable " : "") +
                (highlight === r.team ? "highlight" : "")
              }
              onClick={() => onRow?.(r)}
              onKeyDown={(e) => {
                if (onRow && e.key === "Enter") onRow(r);
              }}
              tabIndex={onRow ? 0 : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.className?.(r) || ""}>
                  {c.render ? c.render(r) : (r[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="empty">暫無符合條件的紀錄</p>}
    </div>
  );
}
