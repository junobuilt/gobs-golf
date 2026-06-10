// GOLDEN ROUND — frozen prod export of round 161 (Wed 2026-06-03, 2-Ball, net,
// best-2, override_holes [9,10], BLIND DRAW: Team 4 (3 players) drew Ron L for
// all 18 holes). No round_payouts in prod → anchored by the gross-from-scores
// check + structural invariants. Covers the best-N blind-draw engine path
// (fill injected into the per-hole best-of pool).

import type { GoldenBundle } from "../build";

export const round161: GoldenBundle = {
  round: {
    id: 161, played_on: "2026-06-03", is_complete: true, format: "2_ball",
    format_config: { basis: "net", best_n: 2, scoring_basis: "net", override_holes: [9, 10], submitted_teams: [1, 2, 3, 4, 5] },
    format_locked_at: "2026-06-03T17:44:28.278+00:00",
  },
  round_players: [
    { id: 1139, player_id: 11, team_number: 1, tee_id: 4, course_handicap: 25, dropped_after_hole: null },
    { id: 1140, player_id: 20, team_number: 1, tee_id: 4, course_handicap: 25, dropped_after_hole: null },
    { id: 1141, player_id: 24, team_number: 1, tee_id: 4, course_handicap: 8, dropped_after_hole: null },
    { id: 1142, player_id: 38, team_number: 1, tee_id: 4, course_handicap: 10, dropped_after_hole: null },
    { id: 1143, player_id: 45, team_number: 2, tee_id: 4, course_handicap: 15, dropped_after_hole: null },
    { id: 1144, player_id: 36, team_number: 2, tee_id: 4, course_handicap: 20, dropped_after_hole: null },
    { id: 1145, player_id: 4, team_number: 2, tee_id: 4, course_handicap: 17, dropped_after_hole: null },
    { id: 1146, player_id: 40, team_number: 2, tee_id: 4, course_handicap: 12, dropped_after_hole: null },
    { id: 1147, player_id: 2, team_number: 3, tee_id: 4, course_handicap: 25, dropped_after_hole: null },
    { id: 1148, player_id: 33, team_number: 3, tee_id: 4, course_handicap: 21, dropped_after_hole: null },
    { id: 1149, player_id: 43, team_number: 3, tee_id: 4, course_handicap: 16, dropped_after_hole: null },
    { id: 1150, player_id: 17, team_number: 3, tee_id: 4, course_handicap: 12, dropped_after_hole: null },
    { id: 1151, player_id: 21, team_number: 4, tee_id: 4, course_handicap: 16, dropped_after_hole: null },
    { id: 1152, player_id: 39, team_number: 4, tee_id: 4, course_handicap: 18, dropped_after_hole: null },
    { id: 1153, player_id: 44, team_number: 4, tee_id: 4, course_handicap: 9, dropped_after_hole: null },
    { id: 1154, player_id: 15, team_number: 5, tee_id: 4, course_handicap: 22, dropped_after_hole: null },
    { id: 1155, player_id: 41, team_number: 5, tee_id: 4, course_handicap: 6, dropped_after_hole: null },
    { id: 1156, player_id: 5, team_number: 5, tee_id: 4, course_handicap: 12, dropped_after_hole: null },
    { id: 1157, player_id: 7, team_number: 5, tee_id: 4, course_handicap: 24, dropped_after_hole: null },
  ],
  tees: [{ id: 4, color: "White/Yellow Combo", slope_rating: 120, course_rating: 67.8, par: 72, sort_order: 4 }],
  holes: [
    { tee_id: 4, hole_number: 1, par: 5, stroke_index: 13 }, { tee_id: 4, hole_number: 2, par: 4, stroke_index: 5 },
    { tee_id: 4, hole_number: 3, par: 3, stroke_index: 15 }, { tee_id: 4, hole_number: 4, par: 4, stroke_index: 1 },
    { tee_id: 4, hole_number: 5, par: 4, stroke_index: 11 }, { tee_id: 4, hole_number: 6, par: 3, stroke_index: 9 },
    { tee_id: 4, hole_number: 7, par: 4, stroke_index: 3 }, { tee_id: 4, hole_number: 8, par: 4, stroke_index: 7 },
    { tee_id: 4, hole_number: 9, par: 5, stroke_index: 17 }, { tee_id: 4, hole_number: 10, par: 4, stroke_index: 18 },
    { tee_id: 4, hole_number: 11, par: 4, stroke_index: 4 }, { tee_id: 4, hole_number: 12, par: 3, stroke_index: 16 },
    { tee_id: 4, hole_number: 13, par: 5, stroke_index: 12 }, { tee_id: 4, hole_number: 14, par: 4, stroke_index: 2 },
    { tee_id: 4, hole_number: 15, par: 3, stroke_index: 8 }, { tee_id: 4, hole_number: 16, par: 4, stroke_index: 10 },
    { tee_id: 4, hole_number: 17, par: 5, stroke_index: 14 }, { tee_id: 4, hole_number: 18, par: 4, stroke_index: 6 },
  ],
  scores: [
    [1139,1,6],[1139,2,4],[1139,3,4],[1139,4,7],[1139,5,5],[1139,6,3],[1139,7,3],[1139,8,5],[1139,9,6],[1139,10,5],[1139,11,4],[1139,12,4],[1139,13,8],[1139,14,7],[1139,15,5],[1139,16,7],[1139,17,7],[1139,18,5],
    [1140,1,3],[1140,2,6],[1140,3,4],[1140,4,5],[1140,5,5],[1140,6,4],[1140,7,7],[1140,8,4],[1140,9,5],[1140,10,3],[1140,11,7],[1140,12,4],[1140,13,6],[1140,14,6],[1140,15,6],[1140,16,6],[1140,17,6],[1140,18,5],
    [1141,1,6],[1141,2,6],[1141,3,3],[1141,4,5],[1141,5,5],[1141,6,4],[1141,7,4],[1141,8,3],[1141,9,5],[1141,10,4],[1141,11,4],[1141,12,3],[1141,13,6],[1141,14,4],[1141,15,3],[1141,16,5],[1141,17,5],[1141,18,5],
    [1142,1,6],[1142,2,4],[1142,3,3],[1142,4,4],[1142,5,5],[1142,6,6],[1142,7,4],[1142,8,6],[1142,9,5],[1142,10,4],[1142,11,6],[1142,12,2],[1142,13,5],[1142,14,5],[1142,15,3],[1142,16,5],[1142,17,5],[1142,18,6],
    [1143,1,6],[1143,2,4],[1143,3,4],[1143,4,4],[1143,5,6],[1143,6,4],[1143,7,5],[1143,8,4],[1143,9,7],[1143,10,4],[1143,11,6],[1143,12,3],[1143,13,6],[1143,14,5],[1143,15,5],[1143,16,5],[1143,17,6],[1143,18,4],
    [1144,1,5],[1144,2,5],[1144,3,3],[1144,4,5],[1144,5,5],[1144,6,4],[1144,7,4],[1144,8,4],[1144,9,6],[1144,10,4],[1144,11,6],[1144,12,4],[1144,13,7],[1144,14,5],[1144,15,5],[1144,16,5],[1144,17,6],[1144,18,6],
    [1145,1,5],[1145,2,4],[1145,3,4],[1145,4,7],[1145,5,5],[1145,6,4],[1145,7,7],[1145,8,5],[1145,9,6],[1145,10,6],[1145,11,7],[1145,12,4],[1145,13,6],[1145,14,5],[1145,15,4],[1145,16,5],[1145,17,5],[1145,18,4],
    [1146,1,7],[1146,2,5],[1146,3,4],[1146,4,5],[1146,5,5],[1146,6,3],[1146,7,5],[1146,8,4],[1146,9,8],[1146,10,5],[1146,11,4],[1146,12,4],[1146,13,6],[1146,14,5],[1146,15,4],[1146,16,5],[1146,17,6],[1146,18,5],
    [1147,1,6],[1147,2,3],[1147,3,4],[1147,4,5],[1147,5,5],[1147,6,4],[1147,7,8],[1147,8,5],[1147,9,6],[1147,10,6],[1147,11,7],[1147,12,6],[1147,13,8],[1147,14,8],[1147,15,3],[1147,16,6],[1147,17,7],[1147,18,5],
    [1148,1,4],[1148,2,5],[1148,3,5],[1148,4,6],[1148,5,5],[1148,6,4],[1148,7,5],[1148,8,6],[1148,9,7],[1148,10,5],[1148,11,7],[1148,12,6],[1148,13,6],[1148,14,4],[1148,15,4],[1148,16,6],[1148,17,6],[1148,18,6],
    [1149,1,6],[1149,2,7],[1149,3,3],[1149,4,5],[1149,5,7],[1149,6,4],[1149,7,5],[1149,8,7],[1149,9,5],[1149,10,4],[1149,11,4],[1149,12,3],[1149,13,6],[1149,14,5],[1149,15,3],[1149,16,7],[1149,17,7],[1149,18,6],
    [1150,1,5],[1150,2,6],[1150,3,3],[1150,4,5],[1150,5,5],[1150,6,3],[1150,7,4],[1150,8,5],[1150,9,6],[1150,10,4],[1150,11,3],[1150,12,4],[1150,13,6],[1150,14,5],[1150,15,4],[1150,16,4],[1150,17,5],[1150,18,4],
    [1151,1,6],[1151,2,5],[1151,3,4],[1151,4,7],[1151,5,5],[1151,6,4],[1151,7,5],[1151,8,5],[1151,9,5],[1151,10,4],[1151,11,7],[1151,12,4],[1151,13,6],[1151,14,5],[1151,15,3],[1151,16,5],[1151,17,6],[1151,18,5],
    [1152,1,5],[1152,2,8],[1152,3,3],[1152,4,7],[1152,5,6],[1152,6,6],[1152,7,5],[1152,8,6],[1152,9,6],[1152,10,4],[1152,11,6],[1152,12,5],[1152,13,8],[1152,14,6],[1152,15,4],[1152,16,7],[1152,17,7],[1152,18,6],
    [1153,1,5],[1153,2,4],[1153,3,3],[1153,4,5],[1153,5,6],[1153,6,4],[1153,7,5],[1153,8,5],[1153,9,4],[1153,10,5],[1153,11,5],[1153,12,5],[1153,13,5],[1153,14,5],[1153,15,4],[1153,16,4],[1153,17,5],[1153,18,5],
    [1154,1,5],[1154,2,5],[1154,3,4],[1154,4,5],[1154,5,5],[1154,6,4],[1154,7,5],[1154,8,5],[1154,9,7],[1154,10,4],[1154,11,6],[1154,12,5],[1154,13,7],[1154,14,5],[1154,15,3],[1154,16,6],[1154,17,7],[1154,18,5],
    [1155,1,5],[1155,2,6],[1155,3,3],[1155,4,5],[1155,5,5],[1155,6,4],[1155,7,4],[1155,8,4],[1155,9,5],[1155,10,4],[1155,11,4],[1155,12,3],[1155,13,6],[1155,14,4],[1155,15,3],[1155,16,5],[1155,17,6],[1155,18,6],
    [1156,1,7],[1156,2,5],[1156,3,3],[1156,4,4],[1156,5,5],[1156,6,3],[1156,7,5],[1156,8,5],[1156,9,5],[1156,10,4],[1156,11,4],[1156,12,3],[1156,13,4],[1156,14,4],[1156,15,3],[1156,16,4],[1156,17,7],[1156,18,4],
    [1157,1,6],[1157,2,5],[1157,3,5],[1157,4,7],[1157,5,5],[1157,6,4],[1157,7,5],[1157,8,5],[1157,9,6],[1157,10,4],[1157,11,5],[1157,12,5],[1157,13,7],[1157,14,4],[1157,15,3],[1157,16,5],[1157,17,5],[1157,18,4],
  ],
  blind_draws: [
    { short_team_number: 4, drawn_player_id: 36, hole_range_start: 1, hole_range_end: 18 },
  ],
  payouts: [],
};
