"use client";

// Global bottom navigation. Client component so it can swap the second slot
// when tournament mode is publicly ON (getTournamentMode): "Leaderboard →
// /leaderboard" becomes "Scoreboard → /tournament/dashboard" (mock v4 nav), the
// muscle-memory entry into the cup. Defaults to Leaderboard until the async
// check resolves post-mount (SSR/first-paint safe), then swaps.

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getTournamentMode } from "@/lib/tournament/mode";

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0012 0V2z" />
    </svg>
  );
}
function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

export default function BottomNav() {
  const pathname = usePathname() ?? "/";
  const [tournamentMode, setTournamentMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const t = await getTournamentMode();
      if (!cancelled) setTournamentMode(t != null);
    })();
    return () => { cancelled = true; };
  }, []);

  const isHome = pathname === "/";
  const isSecond = pathname.startsWith("/leaderboard") || pathname.startsWith("/tournament");
  const isHistory = pathname.startsWith("/history");
  const isPlayers = pathname.startsWith("/players");

  return (
    <nav className="bottom-nav">
      <Link href="/" className={`tourn-focusable${isHome ? " active" : ""}`}>
        <HomeIcon />
        Home
      </Link>
      {tournamentMode ? (
        <Link href="/tournament/dashboard" data-testid="nav-scoreboard" className={`tourn-focusable${isSecond ? " active" : ""}`}>
          <TrophyIcon />
          Scoreboard
        </Link>
      ) : (
        <Link href="/leaderboard" data-testid="nav-leaderboard" className={`tourn-focusable${isSecond ? " active" : ""}`}>
          <TrophyIcon />
          Leaderboard
        </Link>
      )}
      <Link href="/history" className={`tourn-focusable${isHistory ? " active" : ""}`}>
        <HistoryIcon />
        History
      </Link>
      <Link href="/players" className={`tourn-focusable${isPlayers ? " active" : ""}`}>
        <UsersIcon />
        Players
      </Link>
    </nav>
  );
}
