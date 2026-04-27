"use client";

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

export default function AdminDashboard() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [players, setPlayers] = useState<any[]>([]);
  const [matrix, setMatrix] = useState<any[]>([]); 
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [roster, setRoster] = useState<any[]>([]); 
  const [teams, setTeams] = useState<Record<number, any[]>>({
    1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: []
  });

  useEffect(() => {
    async function loadData() {
      const { data: p } = await supabase.from('players').select('*').eq('is_active', true).order('full_name');
      const { data: m } = await supabase.from('played_with_matrix').select('*');
      if (p) setPlayers(p);
      if (m) setMatrix(m);
    }
    loadData();
  }, []);

  const toggleInRoster = (player: any) => {
    if (roster.find(p => p.id === player.id)) {
      setRoster(roster.filter(p => p.id !== player.id));
      const newTeams = { ...teams };
      Object.keys(newTeams).forEach(n => newTeams[parseInt(n)] = newTeams[parseInt(n)].filter(p => p.id !== player.id));
      setTeams(newTeams);
    } else {
      setRoster([...roster, player]);
    }
  };

  const assignToTeam = (player: any, teamNum: number) => {
    const newTeams = { ...teams };
    Object.keys(newTeams).forEach(n => newTeams[parseInt(n)] = newTeams[parseInt(n)].filter(p => p.id !== player.id));
    if (teamNum !== 0) newTeams[teamNum] = [...newTeams[teamNum], player];
    setTeams(newTeams);
  };

  const getCompatibility = (player: any, teamNum: number) => {
    const teammates = teams[teamNum];
    if (teammates.length === 0) return 0;
    let totalMatches = 0;
    teammates.forEach(tm => {
      const match = matrix.find(m => 
        (m.player_a === player.full_name && m.player_b === tm.full_name) ||
        (m.player_b === player.full_name && m.player_a === tm.full_name)
      );
      if (match) totalMatches += match.times_played_together;
    });
    return totalMatches;
  };

  const saveRound = async () => {
    const { data: round, error: rErr } = await supabase.from('rounds').insert({ played_on: selectedDate, course_id: 1 }).select().single();
    if (rErr) return alert(rErr.message);
    const assignments = Object.entries(teams).flatMap(([num, ps]) => 
      ps.map(p => ({ round_id: round.id, player_id: p.id, team_number: parseInt(num), tee_id: 1 }))
    );
    const { error: aErr } = await supabase.from('round_players').insert(assignments);
    if (aErr) alert(aErr.message);
    else alert("Success! Round created and players assigned.");
  };

  const unassigned = roster.filter(r => !Object.values(teams).flat().find(tp => tp.id === r.id));

  return (
    <div className="p-6 max-w-7xl mx-auto bg-slate-50 min-h-screen text-slate-900 font-sans">
      {/* HEADER */}
      <div className="flex justify-between items-center mb-8 bg-blue-900 p-6 rounded-xl shadow-lg text-white">
        <div>
          <h1 className="text-2xl font-black tracking-tight uppercase">GOBs LEAGUE MANAGER <span className="text-blue-300 text-sm ml-2 font-normal">V2 PRO</span></h1>
          <div className="flex items-center gap-2 mt-1 text-blue-100">
             <span>Playing on:</span>
             <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="bg-blue-800 border-none rounded px-2 py-1 text-white font-bold cursor-pointer"/>
          </div>
        </div>
        <button onClick={saveRound} className="bg-green-500 hover:bg-green-400 text-white px-8 py-3 rounded-lg font-bold shadow-md transition-all active:scale-95">FINALIZE & SAVE ROUND</button>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* STEP 1: MASTER ROSTER */}
        <div className="col-span-3 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <h2 className="font-bold text-slate-400 uppercase text-[10px] tracking-widest mb-4">1. Today's Roster</h2>
          <div className="space-y-1 overflow-y-auto max-h-[70vh] pr-2">
            {players.map(p => (
              <button key={p.id} onClick={() => toggleInRoster(p)} className={`w-full text-left px-3 py-2 rounded-md text-sm transition-all ${roster.find(r => r.id === p.id) ? 'bg-blue-600 text-white font-bold' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
                {p.full_name}
              </button>
            ))}
          </div>
        </div>

        {/* STEP 2: DRAFTING AREA */}
        <div className="col-span-9">
          <h2 className="font-bold text-slate-400 uppercase text-[10px] tracking-widest mb-4">2. Assign to Teams</h2>
          
          {/* THE POOL */}
          <div className="bg-white p-4 rounded-xl border border-blue-200 shadow-sm mb-6 flex flex-wrap gap-2 items-center min-h-[60px]">
            <span className="text-[10px] font-black text-blue-500 mr-2 uppercase">Bench:</span>
            {unassigned.length === 0 && <span className="text-slate-300 italic text-sm">Select players on the left to "check them in"...</span>}
            {unassigned.map(p => (
              <span key={p.id} className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-xs font-bold border border-blue-100">
                {p.full_name}
              </span>
            ))}
          </div>

          {/* TEAM GRID */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(num => (
              <div key={num} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <div className="bg-slate-800 p-2 text-white text-[10px] font-black flex justify-between uppercase">
                  <span>Team {num}</span>
                  <span className={teams[num].length > 4 ? 'text-red-400' : 'text-slate-400'}>{teams[num].length} Players</span>
                </div>
                <div className="p-3 min-h-[160px] flex-grow flex flex-col justify-between">
                  <div className="space-y-2">
                    {teams[num].map(p => (
                      <div key={p.id} className="flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-100 text-sm font-medium">
                        {p.full_name}
                        <button onClick={() => assignToTeam(p, 0)} className="text-slate-300 hover:text-red-500 font-bold ml-2">×</button>
                      </div>
                    ))}
                  </div>
                  
                  <select 
                    value="" 
                    onChange={e => assignToTeam(unassigned.find(u => u.id === parseInt(e.target.value)), num)}
                    className="w-full mt-4 p-2 text-xs border border-slate-200 rounded-lg bg-slate-50 text-slate-600 font-bold outline-none hover:border-blue-400"
                  >
                    <option value="" disabled>+ Add from Bench</option>
                    {unassigned.map(u => {
                      const conflict = getCompatibility(u, num);
                      return (
                        <option key={u.id} value={u.id}>
                          {u.full_name} {conflict > 0 ? `(Played together ${conflict}x)` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}