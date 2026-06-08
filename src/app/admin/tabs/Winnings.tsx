"use client";

// Admin Winnings tab (Phase G2 S4a) — READ-ONLY.
// Layout per docs/payout_ui_mockups.html: Funds + Calculator on the top row
// (side-by-side on desktop, stacked on mobile), Historical Payouts full-width
// below. Fund reset + payout override are Session 4b (not here).

import { useEffect, useState } from "react";
import { getActiveSeason, type Season } from "@/lib/seasons";
import type { LeagueSettings } from "@/app/admin/page";
import { resolveBuyIn } from "@/lib/payouts/winningsMoney";
import FundsPanel from "@/components/winnings/FundsPanel";
import CalculatorPanel from "@/components/winnings/CalculatorPanel";
import HistoryPanel from "@/components/winnings/HistoryPanel";

export default function Winnings({ settings }: { settings: LeagueSettings }) {
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [seasonLoaded, setSeasonLoaded] = useState(false);

  const buyIn = resolveBuyIn(settings["buy_in_amount"]);

  useEffect(() => {
    let cancelled = false;
    getActiveSeason().then((s) => {
      if (cancelled) return;
      setActiveSeason(s);
      setSeasonLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "12px" }}>
      {/* Top row: Funds + Calculator (auto-fit collapses to one column on mobile) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "12px",
          marginBottom: "12px",
        }}
      >
        <FundsPanel />
        <CalculatorPanel buyIn={buyIn} />
      </div>

      {/* Full-width history */}
      {seasonLoaded && <HistoryPanel activeSeason={activeSeason} buyIn={buyIn} />}
    </div>
  );
}
