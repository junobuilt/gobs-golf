"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function ActiveRoundPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [noRound, setNoRound] = useState(false);

  useEffect(() => {
    async function find() {
      const today = new Date().toISOString().split("T")[0];
      const { data } = await supabase
        .from("rounds")
        .select("id")
        .eq("played_on", today)
        .eq("is_complete", false)
        .order("created_at", { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        router.replace(`/round/${data[0].id}/scorecard`);
      } else {
        setNoRound(true);
        setLoading(false);
      }
    }
    find();
  }, [router]);

  if (loading && !noRound) {
    return (
      <div className="page-content">
        <div className="loading">
          <div className="loading-dot" />
          <div className="loading-dot" />
          <div className="loading-dot" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="card">
        <div className="empty-state">
          <p style={{ fontWeight: 600, marginBottom: "8px" }}>No active round today</p>
          <p style={{ fontSize: "0.85rem", marginBottom: "16px" }}>
            Start a new round to begin entering scores
          </p>
          <Link href="/round/new" className="btn btn-primary">
            Start New Round
          </Link>
        </div>
      </div>
    </div>
  );
}