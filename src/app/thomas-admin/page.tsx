"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function AdminDashboard() {

  const [players, setPlayers] = useState<any[]>([]);
  const [matrix, setMatrix] = useState<any[]>([]); 
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [roster, setRoster] = useState<any[]>([]); 
  const [teams, setTeams] = useState<Record<number, any[]>>({
    1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: []
  });
  const [showLeaderboard, setShowLeaderboard] = useState(true);
  const [showWeeklyWinners, setShowWeeklyWinners] = useState(true);

  useEffect(() => {
    async function loadData() {
      const { data: p } = await supabase.from('players').select('*').eq('is_active', true).order('full_name');
      const { data: m } = await supabase.from('played_with_matrix').select('*');
      if (p) setPlayers(p);
      if (m) setMatrix(m);

      // Load settings
      const { data: settings } = await supabase.from('league_settings').select('key, value');
      settings?.forEach(s => {
        if (s.key === 'show_leaderboard') setShowLeaderboard(s.value === 'true');
        if (s.key === 'show_weekly_winners') setShowWeeklyWinners(s.value === 'true');
      });
    }
    loadData();
  }, []);

  const toggleSetting = async (key: string, currentValue: boolean) => {
    const newValue = !currentValue;
    if (key === 'show_leaderboard') setShowLeaderboard(newValue);
    if (key === 'show_weekly_winners') setShowWeeklyWinners(newValue);
    await supabase.from('league_settings').update({ value: String(newValue) }).eq('key', key);
  };

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
    // Remove player from ALL teams first to ensure they are only in one place
    Object.keys(newTeams).forEach(n => {
      newTeams[parseInt(n)] = newTeams[parseInt(n)].filter(p => p.id !== player.id);
    });
    // Add to the chosen team
    if (teamNum !== 0) {
      newTeams[teamNum] = [...newTeams[teamNum], player];
    }
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
    const { data: round, error: rErr } = await supabase
      .from('rounds')
      .insert({ played_on: selectedDate, course_id: 1 })
      .select()
      .single();

    if (rErr) return alert(rErr.message);
    
    const assignments = Object.entries(teams).flatMap(([num, ps]) => 
      ps.map(p => ({ 
        round_id: round.id, 
        player_id: p.id, 
        team_number: parseInt(num), 
        tee_id: null // Explicitly null
      }))
    );
    
    const { error: aErr } = await supabase.from('round_players').insert(assignments);
    
    if (aErr) alert(aErr.message);
    else alert("Success!");
  };

  const unassigned = roster.filter(r => !Object.values(teams).flat().find(tp => tp.id === r.id));

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'sans-serif', backgroundColor: '#f8fafc', minHeight: '100vh', color: '#1e293b' }}>
      
      {/* HEADER SECTION */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', backgroundColor: '#1e3a8a', padding: '24px', borderRadius: '12px', color: 'white', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 900 }}>GOBs LEAGUE MANAGER <span style={{ color: '#93c5fd', fontSize: '14px', marginLeft: '8px' }}>V2.1 PRO</span></h1>
          <div style={{ marginTop: '8px', fontSize: '14px' }}>
             Playing on: <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} style={{ background: '#1e40af', border: 'none', color: 'white', fontWeight: 'bold', padding: '4px 8px', borderRadius: '4px' }}/>
          </div>
        </div>
        <button onClick={saveRound} style={{ backgroundColor: '#22c55e', color: 'white', border: 'none', padding: '12px 24px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>FINALIZE & SAVE ROUND</button>
      </div>

      {/* LEAGUE SETTINGS */}
      <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '24px', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)' }}>
        <h2 style={{ fontSize: '12px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px' }}>League Settings</h2>
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <div onClick={() => toggleSetting('show_leaderboard', showLeaderboard)} style={{
              width: '44px', height: '24px', borderRadius: '12px', position: 'relative' as const,
              background: showLeaderboard ? '#22c55e' : '#cbd5e1', transition: 'background 0.2s',
              cursor: 'pointer',
            }}>
              <div style={{
                width: '20px', height: '20px', borderRadius: '50%', background: 'white',
                position: 'absolute' as const, top: '2px', left: showLeaderboard ? '22px' : '2px',
                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </div>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>Show Leaderboard</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <div onClick={() => toggleSetting('show_weekly_winners', showWeeklyWinners)} style={{
              width: '44px', height: '24px', borderRadius: '12px', position: 'relative' as const,
              background: showWeeklyWinners ? '#22c55e' : '#cbd5e1', transition: 'background 0.2s',
              cursor: 'pointer',
            }}>
              <div style={{
                width: '20px', height: '20px', borderRadius: '50%', background: 'white',
                position: 'absolute' as const, top: '2px', left: showWeeklyWinners ? '22px' : '2px',
                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </div>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>Show Weekly Winners</span>
          </label>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '24px' }}>
        
        {/* COLUMN 1: PLAYER SELECTION */}
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)' }}>
          <h2 style={{ fontSize: '12px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px' }}>1. Check-In Players</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '70vh', overflowY: 'auto' }}>
            {players.map(p => (
              <button 
                key={p.id} 
                onClick={() => toggleInRoster(p)} 
                style={{ 
                  textAlign: 'left', 
                  padding: '8px 12px', 
                  borderRadius: '6px', 
                  fontSize: '14px', 
                  border: '1px solid #f1f5f9',
                  cursor: 'pointer',
                  backgroundColor: roster.find(r => r.id === p.id) ? '#2563eb' : '#f8fafc',
                  color: roster.find(r => r.id === p.id) ? 'white' : '#64748b',
                  fontWeight: roster.find(r => r.id === p.id) ? 'bold' : 'normal'
                }}
              >
                {p.full_name}
              </button>
            ))}
          </div>
        </div>

        {/* COLUMN 2: TEAM DRAFTING */}
        <div>
          <h2 style={{ fontSize: '12px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px' }}>2. Assign to Teams</h2>
          
          {/* THE BENCH */}
          <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '12px', border: '1px solid #bfdbfe', marginBottom: '24px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', minHeight: '60px' }}>
            <span style={{ fontSize: '10px', fontWeight: 'black', color: '#3b82f6', marginRight: '8px', textTransform: 'uppercase' }}>Bench Pool:</span>
            {unassigned.length === 0 && <span style={{ color: '#cbd5e1', fontStyle: 'italic', fontSize: '14px' }}>Click players on the left to add them to the bench...</span>}
            {unassigned.map(p => (
              <span key={p.id} style={{ backgroundColor: '#eff6ff', color: '#1d4ed8', padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 'bold', border: '1px solid #dbeafe' }}>
                {p.full_name}
              </span>
            ))}
          </div>

          {/* THE GRID OF TEAMS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map(num => (
              <div key={num} style={{ backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ backgroundColor: '#1e293b', padding: '8px 12px', color: 'white', fontSize: '10px', fontWeight: 'black', display: 'flex', justifyContent: 'space-between', textTransform: 'uppercase' }}>
                  <span>Team #{num}</span>
                  <span style={{ color: teams[num].length > 4 ? '#f87171' : '#94a3b8' }}>{teams[num].length} Players</span>
                </div>
                <div style={{ padding: '12px', minHeight: '150px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {teams[num].map(p => (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc', padding: '8px', borderRadius: '6px', fontSize: '13px', border: '1px solid #f1f5f9' }}>
                        {p.full_name}
                        <button onClick={() => assignToTeam(p, 0)} style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>×</button>
                      </div>
                    ))}
                  </div>
                  
                  <select 
                    value="" 
                    onChange={e => assignToTeam(unassigned.find(u => u.id === parseInt(e.target.value)), num)}
                    style={{ width: '100%', marginTop: '16px', padding: '8px', fontSize: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', cursor: 'pointer' }}
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