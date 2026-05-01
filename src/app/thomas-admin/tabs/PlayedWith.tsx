"use client";

import { useState, useEffect } from "react";
import { Player, MatrixRow } from "../page";

interface Props {
  players: Player[];
  matrix: MatrixRow[];
}

const C = {
  navy: "#0c3057",
  border: "rgba(0,0,0,0.08)",
  bg: "#f5f4f0",
};

function cellColor(n: number): { bg: string; color: string } {
  if (n === 0) return { bg: "transparent", color: "#d1d5db" };
  if (n <= 2)  return { bg: "#dcfce7", color: "#166534" };
  if (n <= 4)  return { bg: "#fef9c3", color: "#854d0e" };
  if (n <= 6)  return { bg: "#ffedd5", color: "#9a3412" };
  return { bg: "#fee2e2", color: "#991b1b" };
}

function getCount(matrix: MatrixRow[], a: string, b: string): number {
  if (a === b) return -1;
  const row = matrix.find(m =>
    (m.player_a === a && m.player_b === b) ||
    (m.player_b === a && m.player_a === b)
  );
  return row?.times_played_together ?? 0;
}

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return mobile;
}

export default function PlayedWith({ players, matrix }: Props) {
  const isMobile = useIsMobile();
  const [mobileSearch, setMobileSearch] = useState("");

  const names = players.map(p => p.full_name);

  const legend = [
    { label: "Never", ...cellColor(0), example: "—" },
    { label: "1–2×", ...cellColor(1), example: "1" },
    { label: "3–4×", ...cellColor(3), example: "3" },
    { label: "5–6×", ...cellColor(5), example: "5" },
    { label: "7+×",  ...cellColor(7), example: "7" },
  ];

  if (isMobile) {
    const searchLower = mobileSearch.toLowerCase().trim();
    const matchedPlayer = players.find(p =>
      p.full_name.toLowerCase().includes(searchLower) ||
      (p.display_name || "").toLowerCase().includes(searchLower)
    );

    const pairings = matchedPlayer
      ? players
          .filter(p => p.id !== matchedPlayer.id)
          .map(p => ({ player: p, count: getCount(matrix, matchedPlayer.full_name, p.full_name) }))
          .sort((a, b) => b.count - a.count)
      : [];

    return (
      <div style={{ maxWidth: "500px", margin: "0 auto", padding: "24px 16px" }}>
        <div style={{ marginBottom: "20px" }}>
          <input
            placeholder="Search a player…"
            value={mobileSearch}
            onChange={e => setMobileSearch(e.target.value)}
            style={{
              width: "100%", padding: "10px 14px",
              border: `1px solid ${C.border}`, borderRadius: "8px",
              fontSize: "0.9rem", fontFamily: "DM Sans, system-ui, sans-serif",
              outline: "none", background: "white", color: "#1f2937",
            }}
          />
        </div>

        {matchedPlayer && (
          <>
            <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
              {matchedPlayer.display_name || matchedPlayer.full_name} — played with
            </div>
            <div style={{ background: "white", borderRadius: "10px", border: `1px solid ${C.border}`, overflow: "hidden" }}>
              {pairings.map((pair, i) => {
                const { bg, color } = cellColor(pair.count);
                return (
                  <div key={pair.player.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "11px 16px",
                    borderBottom: i === pairings.length - 1 ? "none" : `1px solid ${C.border}`,
                  }}>
                    <span style={{ fontSize: "0.88rem", color: "#1f2937" }}>
                      {pair.player.display_name || pair.player.full_name}
                    </span>
                    <span style={{
                      minWidth: "32px", textAlign: "center",
                      padding: "3px 10px", borderRadius: "999px",
                      background: bg || "#f3f4f6", color: color || "#9ca3af",
                      fontSize: "0.82rem", fontWeight: 700,
                    }}>
                      {pair.count === 0 ? "—" : pair.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!matchedPlayer && mobileSearch.length > 0 && (
          <div style={{ textAlign: "center", color: "#9ca3af", fontSize: "0.85rem", padding: "20px" }}>
            No player found
          </div>
        )}
      </div>
    );
  }

  // Desktop heatmap
  const cellSize = Math.max(28, Math.min(40, Math.floor(700 / names.length)));
  const nameColWidth = 120;

  return (
    <div style={{ padding: "24px 16px", overflowX: "auto" }}>
      {/* Legend */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "20px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Times played together:
        </span>
        {legend.map(l => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{
              width: "24px", height: "24px", borderRadius: "5px",
              background: l.bg || "#f3f4f6",
              border: `1px solid ${C.border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "0.7rem", fontWeight: 700, color: l.color || "#9ca3af",
            }}>
              {l.example}
            </div>
            <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{l.label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "inline-block", fontSize: "0", border: `1px solid ${C.border}`, borderRadius: "10px", overflow: "hidden", background: "white" }}>
        {/* Header row */}
        <div style={{ display: "flex" }}>
          <div style={{ width: `${nameColWidth}px`, flexShrink: 0 }} />
          {names.map(name => (
            <div
              key={name}
              title={name}
              style={{
                width: `${cellSize}px`, height: `${nameColWidth}px`, flexShrink: 0,
                display: "flex", alignItems: "flex-end", justifyContent: "center",
                paddingBottom: "6px",
                borderLeft: `1px solid ${C.border}`,
              }}
            >
              <span style={{
                fontSize: "0.6rem", fontWeight: 600, color: "#6b7280",
                writingMode: "vertical-rl", transform: "rotate(180deg)",
                whiteSpace: "nowrap", maxHeight: `${nameColWidth - 8}px`, overflow: "hidden",
              }}>
                {name.split(" ")[0]}
              </span>
            </div>
          ))}
        </div>

        {/* Data rows */}
        {names.map((rowName, ri) => (
          <div key={rowName} style={{ display: "flex", borderTop: `1px solid ${C.border}` }}>
            {/* Row label */}
            <div style={{
              width: `${nameColWidth}px`, flexShrink: 0,
              display: "flex", alignItems: "center",
              padding: "0 10px",
              fontSize: "0.72rem", fontWeight: 600, color: "#374151",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {rowName.split(" ").slice(0, 2).join(" ")}
            </div>

            {/* Cells */}
            {names.map((colName, ci) => {
              const count = getCount(matrix, rowName, colName);
              const isSelf = ri === ci;
              const { bg, color } = isSelf ? { bg: C.navy + "18", color: C.navy } : cellColor(count);
              return (
                <div
                  key={colName}
                  title={isSelf ? rowName : `${rowName} & ${colName}: ${count}×`}
                  style={{
                    width: `${cellSize}px`, height: `${cellSize}px`, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: bg || "transparent",
                    borderLeft: `1px solid ${C.border}`,
                    fontSize: "0.65rem", fontWeight: 700,
                    color: isSelf ? C.navy : (color || "#9ca3af"),
                  }}
                >
                  {isSelf ? "·" : count === 0 ? "" : count}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
