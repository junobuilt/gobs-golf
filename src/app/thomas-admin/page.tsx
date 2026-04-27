"use client";

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

export default function AdminDashboard() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [players, setPlayers] = useState<any[]>([]);
  const [matrix, setMatrix] = useState<any[]>([]); // "Played With" history
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

  // Moves player from Master List to the "Unassigned" Roster
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
    // Remove from any current team
    Object.keys(newTeams).forEach(n => newTeams[parseInt(n)] = newTeams[parseInt(n)].filter(p => p.id !== player.id));
    // Add to new team if not "removing" (teamNum 0)
    if (teamNum !== 0) newTeams[teamNum] = [...newTeams[teamNum], player];
    setTeams(newTeams);
  };

  // Helper to check how many times a player has played with a specific team
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
    else alert("Round successfully created!");
  };

  const unassigned = roster.filter(r => !Object.values(teams).flat().find(tp => tp.id === r.id));

  return (
    <div className="p-6 max-w-7xl mx-auto bg-gray-50 min-h-screen text-slate-900 font-sans">
      <div className="flex justify-between items-center mb-8 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
          <h1 className="text-2xl font-black text-blue-900">GOBs Manager v2</h1>
          <p className="text-slate-500 text-sm">Drafting for: <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="font-bold text-blue-600 border-none bg-transparent outline-none cursor-pointer"/></p>
        </div>
        <button onClick={saveRound} className="bg-blue-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-blue-700 shadow-md active:scale-95 transition-all">FINALIZE & SAVE ROUND</button>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* STEP 1: MASTER LIST */}
        <div className="col-span-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <h2 className="font-bold mb-4 flex items-center gap-2"><span className="bg-slate-800 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">1</span> Playing Today?</h2>
          <div className="space-y-1 overflow-y-auto max-h-[70vh] pr-2 custom-scrollbar">
            {players.map(p => (
              <button key={p.id} onClick={() => toggleInRoster(p)} className={`w-full text-left px-3 py-2 rounded-md text-sm transition-all ${roster.find(r => r.id === p.id) ? 'bg-blue-600 text-white font-semibold' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                {p.full_name}
              </button>
            ))}
          </div>
        </div>

        {/* STEP 2: TEAMS */}
        <div className="col-span-9">
          <h2 className="font-bold mb-4 flex items-center gap-2"><span className="bg-slate-800 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">2</span> Assemble Teams</h2>
          
          {/* THE UNASSIGNED POOL */}
          <div className="bg-blue-50 p-4 rounded-xl border-2 border-dashed border-blue-200 mb-6">
            <p className="text-xs font-bold text-blue-400 uppercase mb-2">Unassigned Pool ({unassigned.length})</p>
            <div className="flex flex-wrap gap-2">
              {unassigned.length === 0 && <p className="text-blue-300 italic text-sm">All players assigned!</p>}
              {unassigned.map(p => (
                <div key={p.id} className="bg-white border border-blue-200 px-3 py-1 rounded shadow-sm text-sm font-medium">
                  {p.full_name}
                </div>
              ))}
            </div>
          </div>

          {/* TEAM GRID */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(num => (
              <div key={num} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-slate-800 p-2 text-white text-xs font-bold flex justify-between">
                  <span>TEAM {num}</span>
                  <span>{teams[num].length}/4</span>
                </div>
                <div className="p-3 min-h-[140px] space-y-2">
                  {teams[num].map(p => (
                    <div key={p.id} className="group flex justify-between items-center bg-slate-50 p-2 rounded text-sm border border-slate-100">
                      <span>{p.full_name}</span>
                      <button onClick={() => assignToTeam(p, 0)} className="text-slate-300 hover:text-red-500 font-bold">×</button>
                    </div>
                  ))}
                  
                  <select 
                    value="" 
                    onChange={e => assignToTeam(unassigned.find(u => u.id === parseInt(e.target.value)), num)}
                    className="w-full mt-2 p-2 text-xs border border-slate-200 rounded bg-slate-50 text-slate-500 outline-none hover:border-blue-300 transition-colors"
                  >
                    <option value="" disabled>+ Add Player</option>
                    {unassigned.map(u => {
                      const conflictScore = getCompatibility(u, num);
                      return (
                        <option key={u.id} value={u.id}>
                          {u.full_name} {conflictScore > 0 ? `(Conflict: ${conflictScore})` : ''}
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