// GOLDEN ROUND — frozen prod export of round 171 (Mon 2026-06-08, 2-Ball, net,
// best-2, override_holes [9,12], NO blind draw). Exported read-only 2026-06-09.
// Locked round_payouts: Team 3 = 1st (−17), Team 1 = 2nd (−8), Team 4 = 3rd
// (−7); Team 2 unpaid/last (+2). This is the round whose History list crowned
// the wrong team (TD33) — kept as the bedrock regression golden.

import type { GoldenBundle } from "../build";

export const round171: GoldenBundle = {
  round: {
    id: 171, played_on: "2026-06-08", is_complete: true, format: "2_ball",
    format_config: { basis: "net", best_n: 2, scoring_basis: "net", override_holes: [9, 12], submitted_teams: [1, 2, 3, 4] },
    format_locked_at: "2026-06-08T17:50:14.07+00:00",
  },
  round_players: [
    { id: 1210, player_id: 77, team_number: 1, tee_id: 4, course_handicap: 30, dropped_after_hole: null },
    { id: 1211, player_id: 33, team_number: 1, tee_id: 4, course_handicap: 21, dropped_after_hole: null },
    { id: 1212, player_id: 44, team_number: 1, tee_id: 4, course_handicap: 8, dropped_after_hole: null },
    { id: 1213, player_id: 45, team_number: 1, tee_id: 4, course_handicap: 14, dropped_after_hole: null },
    { id: 1214, player_id: 5, team_number: 2, tee_id: 4, course_handicap: 11, dropped_after_hole: null },
    { id: 1215, player_id: 55, team_number: 2, tee_id: 4, course_handicap: 7, dropped_after_hole: null },
    { id: 1216, player_id: 39, team_number: 2, tee_id: 4, course_handicap: 19, dropped_after_hole: null },
    { id: 1217, player_id: 14, team_number: 2, tee_id: 4, course_handicap: 14, dropped_after_hole: null },
    { id: 1218, player_id: 24, team_number: 3, tee_id: 4, course_handicap: 8, dropped_after_hole: null },
    { id: 1219, player_id: 8, team_number: 3, tee_id: 4, course_handicap: 19, dropped_after_hole: null },
    { id: 1220, player_id: 40, team_number: 3, tee_id: 4, course_handicap: 13, dropped_after_hole: null },
    { id: 1221, player_id: 2, team_number: 3, tee_id: 4, course_handicap: 25, dropped_after_hole: null },
    { id: 1224, player_id: 21, team_number: 4, tee_id: 4, course_handicap: 16, dropped_after_hole: null },
    { id: 1225, player_id: 36, team_number: 4, tee_id: 4, course_handicap: 20, dropped_after_hole: null },
    { id: 1228, player_id: 78, team_number: 4, tee_id: 4, course_handicap: 21, dropped_after_hole: null },
    { id: 1229, player_id: 41, team_number: 4, tee_id: 4, course_handicap: 7, dropped_after_hole: null },
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
    [1210,1,6],[1210,2,6],[1210,3,5],[1210,4,6],[1210,5,7],[1210,6,4],[1210,7,7],[1210,8,5],[1210,9,9],[1210,10,7],[1210,11,6],[1210,12,3],[1210,13,6],[1210,14,5],[1210,15,4],[1210,16,7],[1210,17,8],[1210,18,5],
    [1211,1,6],[1211,2,5],[1211,3,4],[1211,4,7],[1211,5,5],[1211,6,5],[1211,7,5],[1211,8,4],[1211,9,7],[1211,10,5],[1211,11,6],[1211,12,5],[1211,13,7],[1211,14,6],[1211,15,4],[1211,16,6],[1211,17,6],[1211,18,5],
    [1212,1,6],[1212,2,5],[1212,3,4],[1212,4,6],[1212,5,5],[1212,6,4],[1212,7,5],[1212,8,5],[1212,9,5],[1212,10,5],[1212,11,4],[1212,12,3],[1212,13,5],[1212,14,7],[1212,15,5],[1212,16,3],[1212,17,5],[1212,18,5],
    [1213,1,7],[1213,2,5],[1213,3,3],[1213,4,5],[1213,5,4],[1213,6,3],[1213,7,5],[1213,8,5],[1213,9,6],[1213,10,4],[1213,11,7],[1213,12,4],[1213,13,6],[1213,14,4],[1213,15,4],[1213,16,5],[1213,17,6],[1213,18,4],
    [1214,1,6],[1214,2,5],[1214,3,3],[1214,4,5],[1214,5,5],[1214,6,4],[1214,7,5],[1214,8,6],[1214,9,5],[1214,10,5],[1214,11,5],[1214,12,4],[1214,13,6],[1214,14,4],[1214,15,5],[1214,16,5],[1214,17,6],[1214,18,5],
    [1215,1,6],[1215,2,4],[1215,3,3],[1215,4,4],[1215,5,4],[1215,6,3],[1215,7,6],[1215,8,4],[1215,9,5],[1215,10,5],[1215,11,6],[1215,12,5],[1215,13,6],[1215,14,5],[1215,15,6],[1215,16,5],[1215,17,6],[1215,18,4],
    [1216,1,8],[1216,2,6],[1216,3,4],[1216,4,6],[1216,5,7],[1216,6,6],[1216,7,6],[1216,8,6],[1216,9,7],[1216,10,6],[1216,11,6],[1216,12,4],[1216,13,7],[1216,14,5],[1216,15,4],[1216,16,5],[1216,17,6],[1216,18,5],
    [1217,1,6],[1217,2,5],[1217,3,4],[1217,4,5],[1217,5,6],[1217,6,3],[1217,7,5],[1217,8,4],[1217,9,4],[1217,10,5],[1217,11,6],[1217,12,3],[1217,13,7],[1217,14,5],[1217,15,5],[1217,16,6],[1217,17,5],[1217,18,7],
    [1218,1,5],[1218,2,4],[1218,3,3],[1218,4,4],[1218,5,4],[1218,6,4],[1218,7,4],[1218,8,5],[1218,9,5],[1218,10,5],[1218,11,7],[1218,12,5],[1218,13,6],[1218,14,5],[1218,15,3],[1218,16,5],[1218,17,5],[1218,18,5],
    [1219,1,7],[1219,2,5],[1219,3,4],[1219,4,6],[1219,5,6],[1219,6,6],[1219,7,5],[1219,8,5],[1219,9,6],[1219,10,5],[1219,11,6],[1219,12,2],[1219,13,5],[1219,14,5],[1219,15,3],[1219,16,4],[1219,17,6],[1219,18,6],
    [1220,1,6],[1220,2,4],[1220,3,5],[1220,4,5],[1220,5,5],[1220,6,6],[1220,7,6],[1220,8,5],[1220,9,5],[1220,10,4],[1220,11,4],[1220,12,3],[1220,13,5],[1220,14,5],[1220,15,4],[1220,16,5],[1220,17,6],[1220,18,4],
    [1221,1,7],[1221,2,6],[1221,3,4],[1221,4,6],[1221,5,6],[1221,6,4],[1221,7,5],[1221,8,4],[1221,9,5],[1221,10,6],[1221,11,5],[1221,12,4],[1221,13,7],[1221,14,5],[1221,15,5],[1221,16,6],[1221,17,7],[1221,18,5],
    [1224,1,6],[1224,2,4],[1224,3,4],[1224,4,6],[1224,5,5],[1224,6,5],[1224,7,5],[1224,8,6],[1224,9,7],[1224,10,4],[1224,11,5],[1224,12,4],[1224,13,6],[1224,14,5],[1224,15,5],[1224,16,5],[1224,17,6],[1224,18,6],
    [1225,1,6],[1225,2,5],[1225,3,5],[1225,4,4],[1225,5,4],[1225,6,5],[1225,7,5],[1225,8,5],[1225,9,5],[1225,10,4],[1225,11,7],[1225,12,4],[1225,13,6],[1225,14,5],[1225,15,4],[1225,16,6],[1225,17,6],[1225,18,5],
    [1228,1,8],[1228,2,5],[1228,3,5],[1228,4,7],[1228,5,5],[1228,6,5],[1228,7,5],[1228,8,5],[1228,9,6],[1228,10,5],[1228,11,4],[1228,12,5],[1228,13,6],[1228,14,4],[1228,15,3],[1228,16,7],[1228,17,6],[1228,18,6],
    [1229,1,6],[1229,2,5],[1229,3,4],[1229,4,5],[1229,5,5],[1229,6,3],[1229,7,4],[1229,8,5],[1229,9,5],[1229,10,5],[1229,11,6],[1229,12,3],[1229,13,6],[1229,14,6],[1229,15,4],[1229,16,5],[1229,17,5],[1229,18,5],
  ],
  blind_draws: [],
  payouts: [
    { team_number: 3, place: 1, per_player: 15 },
    { team_number: 1, place: 2, per_player: 8 },
    { team_number: 4, place: 3, per_player: 5 },
  ],
};
