"use client";

import { useState, useEffect } from 'react';
// This assumes Claude created a supabase client in your 'utils' or 'lib' folder
// If this line shows a red underline, we will fix the path in the next step!
import { createClient } from '@supabase/supabase-js';

export default function AdminDashboard() {
  // Use the environment variables directly to avoid dependency issues
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [players, setPlayers] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [roster, setRoster] = useState<any[]>([]); 
  const [teams, setTeams] = useState<Record<number, any[]>>({
    1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] , 8: []
  });

  useEffect(() => {
    async function loadPlayers() {
      const { data } = await supabase
        .from('players')
        .select('*')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (data) setPlayers(data);
    }
    loadPlayers();
  }, []);

  const togglePlayerInRoster = (player: any) => {
    if (roster.find(p => p.id === player.id)) {
      setRoster(roster.filter(p => p.id !== player.id));
      const newTeams = { ...teams };
      Object.keys(newTeams).forEach(num => {
        newTeams[parseInt(num)] = newTeams[parseInt(num)].filter(p => p.id !== player.id);
      });
      setTeams(newTeams);
    } else {
      setRoster([...roster, player]);
    }
  };

  const assignToTeam = (player: any, teamNum: number) => {
    const newTeams = { ...teams };
    Object.keys(newTeams).forEach(num => {
      newTeams[parseInt(num)] = newTeams[parseInt(num)].filter(p => p.id !== player.id);
    });
    if (teamNum !== 0) {
      newTeams[teamNum] = [...newTeams[teamNum], player];
    }
    setTeams(newTeams);
  };

  const saveRound = async () => {
    const { data: round, error: roundError } = await supabase
      .from('rounds')
      .insert({ played_on: selectedDate, course_id: 1 }) 
      .select()
      .single();

    if (roundError) return alert("Error: " + roundError.message);

    const assignments = Object.entries(teams).flatMap(([num, players]) => 
      players.map(p => ({
        round_id: round.id,
        player_id: p.id,
        team_number: parseInt(num),
        tee_id: 1 
      }))
    );

    const { error: assignError } = await supabase.from('round_players').insert(assignments);

    if (assignError) alert("Error: " + assignError.message);
    else alert("Success! Teams saved.");
  };

  return (
    <div className="p-8 max-w-6xl mx-auto font-sans bg-white min-h-screen text-black">
      <h1 className="text-3xl font-bold mb-6">GOBs League Manager</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-gray-50 p-4 rounded border">
          <h2 className="text-xl font-semibold mb-4">1. Who is playing?</h2>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="mb-4 p-2 border rounded w-full bg-white"/>
          <div className="space-y-1 max-h-[500px] overflow-y-auto">
            {players.map(p => (
              <button key={p.id} onClick={() => togglePlayerInRoster(p)} className={`w-full text-left p-2 rounded border ${roster.find(r => r.id === p.id) ? 'bg-green-100 border-green-500' : 'bg-white'}`}>
                {p.full_name}
              </button>
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <h2 className="text-xl font-semibold mb-4">2. Assign Teams</h2>
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(num => (
              <div key={num} className="bg-white p-4 rounded border shadow-sm">
                <h3 className="font-bold border-b mb-2">Team #{num}</h3>
                <div className="min-h-[60px] space-y-1">
                  {teams[num].map(p => (
                    <div key={p.id} className="text-sm bg-blue-50 p-1 flex justify-between">
                      {p.full_name} <button onClick={() => assignToTeam(p, 0)} className="text-red-500">×</button>
                    </div>
                  ))}
                  <select value="" onChange={(e) => {
                    const p = roster.find(r => r.id === parseInt(e.target.value));
                    if (p) assignToTeam(p, num);
                  }} className="w-full text-xs p-1 border mt-1">
                    <option value="" disabled>Add Player...</option>
                    {roster.filter(r => !Object.values(teams).flat().find(tp => tp.id === r.id)).map(r => (
                      <option key={r.id} value={r.id}>{r.full_name}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
          <button onClick={saveRound} className="mt-8 w-full bg-blue-600 text-white font-bold py-4 rounded hover:bg-blue-700">SAVE ROUND & TEAMS</button>
        </div>
      </div>
    </div>
  );
}