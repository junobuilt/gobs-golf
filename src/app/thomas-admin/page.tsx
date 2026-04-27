"use client";

import { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export default function AdminDashboard() {
  const supabase = createClientComponentClient();
  const [players, setPlayers] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [roster, setRoster] = useState<any[]>([]); 
  const [teams, setTeams] = useState<Record<number, any[]>>({
    1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: []
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
  }, [supabase]);

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

    if (roundError) return alert("Error creating round: " + roundError.message);

    const assignments = Object.entries(teams).flatMap(([num, players]) => 
      players.map(p => ({
        round_id: round.id,
        player_id: p.id,
        team_number: parseInt(num),
        tee_id: 1 
      }))
    );

    if (assignments.length === 0) return alert("Please assign at least one player to a team.");

    const { error: assignError } = await supabase
      .from('round_players')
      .insert(assignments);

    if (assignError) {
        alert("Error saving teams: " + assignError.message);
    } else {
        alert("Round & Teams Saved Successfully!");
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto font-sans bg-white min-h-screen">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">GOBs League Manager</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-gray-50 p-4 rounded-lg border">
          <h2 className="text-xl font-semibold mb-4 text-gray-700">1. Select Players</h2>
          <input 
            type="date" 
            value={selectedDate} 
            onChange={(e) => setSelectedDate(e.target.value)}
            className="mb-4 p-2 border rounded w-full text-black"
          />
          <div className="space-y-1 max-h-[600px] overflow-y-auto">
            {players.map(player => (
              <button
                key={player.id}
                onClick={() => togglePlayerInRoster(player)}
                className={`w-full text-left p-2 rounded border transition-colors ${
                  roster.find(p => p.id === player.id) 
                  ? 'bg-green-100 border-green-500 text-green-800' 
                  : 'bg-white text-gray-600 hover:bg-gray-100'
                }`}
              >
                {player.full_name}
              </button>
            ))}
          </div>
        </div>

        <div className="md:col-span-2">
          <h2 className="text-xl font-semibold mb-4 text-gray-700">2. Assign Teams</h2>
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(num => (
              <div key={num} className="bg-white p-4 rounded-lg border shadow-sm border-gray-200">
                <h3 className="font-bold border-b pb-2 mb-2 text-gray-800">Team #{num}</h3>
                <div className="min-h-[100px] space-y-1">
                  {teams[num].map(p => (
                    <div key={p.id} className="text-sm bg-blue-50 text-blue-800 p-2 rounded flex justify-between items-center">
                      {p.full_name}
                      <button onClick={() => assignToTeam(p, 0)} className="text-red-500 font-bold ml-2 hover:text-red-700">×</button>
                    </div>
                  ))}
                  <select 
                    value=""
                    onChange={(e) => {
                      const p = roster.find(r => r.id === parseInt(e.target.value));
                      if (p) assignToTeam(p, num);
                    }}
                    className="w-full text-xs p-2 border mt-2 rounded bg-gray-50 text-gray-700"
                  >
                    <option value="" disabled>Add Player...</option>
                    {roster
                      .filter(r => !Object.values(teams).flat().find(tp => tp.id === r.id))
                      .map(r => (
                        <option key={r.id} value={r.id}>{r.full_name}</option>
                      ))
                    }
                  </select>
                </div>
              </div>
            ))}
          </div>

          <button 
            onClick={saveRound}
            className="mt-8 w-full bg-blue-600 text-white font-bold py-4 rounded-lg hover:bg-blue-700 shadow-lg transition-transform active:scale-95"
          >
            SAVE ROUND & TEAMS
          </button>
        </div>
      </div>
    </div>
  );
}