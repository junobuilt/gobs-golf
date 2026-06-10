"use client";

// F.1 Parts 1 + 2 — global-nav History tab. Lists every finalized round
// (newest first) as a tappable mini-leaderboard, with an optional "Filter by
// player" control (session-only; persistence deferred to I15). Shares the
// read-only list component with the admin Settings History tab.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { loadRoundsList, type RoundListItem } from "@/lib/round/loadRoundsList";
import PlayerCombobox, { type ComboOption } from "@/components/playedWith/PlayerCombobox";
import HistoryRoundList from "@/components/history/HistoryRoundList";

export default function HistoryPage() {
  const [rounds, setRounds] = useState<RoundListItem[]>([]);
  const [players, setPlayers] = useState<ComboOption[]>([]);
  const [filterPlayerId, setFilterPlayerId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [items, { data: playerRows }] = await Promise.all([
        loadRoundsList(),
        supabase
          .from("players")
          .select("id, full_name, is_active")
          .eq("is_active", true)
          .order("full_name"),
      ]);
      if (cancelled) return;
      setRounds(items);
      setPlayers(
        (playerRows ?? []).map((p: any) => ({ id: p.id as number, label: p.full_name as string })),
      );
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 14px 120px" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <PlayerCombobox
            options={players}
            value={filterPlayerId}
            onChange={setFilterPlayerId}
            placeholder="Filter by player"
            ariaLabel="Filter rounds by player"
          />
        </div>
        {filterPlayerId != null && (
          <button
            type="button"
            onClick={() => setFilterPlayerId(null)}
            style={{
              border: "1.5px solid #cdd8e3", background: "#fff", color: "#5a6b7d",
              fontSize: 14, fontWeight: 600, padding: "11px 14px", borderRadius: 11,
              cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
            }}
          >
            All rounds
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "#64748b", padding: "40px 16px", fontSize: 14 }}>
          Loading history…
        </div>
      ) : (
        <HistoryRoundList rounds={rounds} filterPlayerId={filterPlayerId} />
      )}
    </div>
  );
}
