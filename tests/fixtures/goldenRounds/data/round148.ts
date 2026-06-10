// GOLDEN ROUND — frozen prod export of round 148 (Wed 2026-05-13, GOBS
// Stableford, net, NO override holes, MIXED TEES (Wayne V on White/id2, rest on
// Combo/id4), BLIND DRAW: 1-player Team 1 (Kevin I) drew Dan Green for all 18.
// No round_payouts in prod → gross-from-scores anchor + invariants. Covers the
// Stableford engine path (points, gobs table) AND its blind-draw accumulation.

import type { GoldenBundle } from "../build";

export const round148: GoldenBundle = {
  round: {
    id: 148, played_on: "2026-05-13", is_complete: true, format: "gobs_stableford",
    format_config: { scoring_basis: "net", override_holes: [] },
    format_locked_at: "2026-05-13T12:00:00+00:00",
  },
  round_players: [
    { id: 1054, player_id: 24, team_number: 1, tee_id: 4, course_handicap: 9, dropped_after_hole: null },
    { id: 1055, player_id: 32, team_number: 2, tee_id: 4, course_handicap: 22, dropped_after_hole: null },
    { id: 1056, player_id: 20, team_number: 2, tee_id: 4, course_handicap: 26, dropped_after_hole: null },
    { id: 1057, player_id: 6, team_number: 3, tee_id: 4, course_handicap: 12, dropped_after_hole: null },
    { id: 1058, player_id: 40, team_number: 3, tee_id: 4, course_handicap: 13, dropped_after_hole: null },
    { id: 1059, player_id: 45, team_number: 4, tee_id: 4, course_handicap: 16, dropped_after_hole: null },
    { id: 1060, player_id: 11, team_number: 4, tee_id: 4, course_handicap: 27, dropped_after_hole: null },
    { id: 1061, player_id: 2, team_number: 5, tee_id: 4, course_handicap: 24, dropped_after_hole: null },
    { id: 1062, player_id: 26, team_number: 5, tee_id: 4, course_handicap: 17, dropped_after_hole: null },
    { id: 1063, player_id: 55, team_number: 6, tee_id: 2, course_handicap: 7, dropped_after_hole: null },
    { id: 1064, player_id: 33, team_number: 6, tee_id: 4, course_handicap: 20, dropped_after_hole: null },
    { id: 1065, player_id: 35, team_number: 7, tee_id: 4, course_handicap: 17, dropped_after_hole: null },
    { id: 1066, player_id: 5, team_number: 7, tee_id: 4, course_handicap: 12, dropped_after_hole: null },
  ],
  tees: [
    { id: 2, color: "White", slope_rating: 124, course_rating: 68.6, par: 72, sort_order: 2 },
    { id: 4, color: "White/Yellow Combo", slope_rating: 120, course_rating: 67.8, par: 72, sort_order: 4 },
  ],
  holes: [
    { tee_id: 2, hole_number: 1, par: 5, stroke_index: 13 }, { tee_id: 2, hole_number: 2, par: 4, stroke_index: 5 },
    { tee_id: 2, hole_number: 3, par: 3, stroke_index: 15 }, { tee_id: 2, hole_number: 4, par: 4, stroke_index: 1 },
    { tee_id: 2, hole_number: 5, par: 4, stroke_index: 11 }, { tee_id: 2, hole_number: 6, par: 3, stroke_index: 9 },
    { tee_id: 2, hole_number: 7, par: 4, stroke_index: 3 }, { tee_id: 2, hole_number: 8, par: 4, stroke_index: 7 },
    { tee_id: 2, hole_number: 9, par: 5, stroke_index: 17 }, { tee_id: 2, hole_number: 10, par: 4, stroke_index: 18 },
    { tee_id: 2, hole_number: 11, par: 4, stroke_index: 4 }, { tee_id: 2, hole_number: 12, par: 3, stroke_index: 16 },
    { tee_id: 2, hole_number: 13, par: 5, stroke_index: 12 }, { tee_id: 2, hole_number: 14, par: 4, stroke_index: 2 },
    { tee_id: 2, hole_number: 15, par: 3, stroke_index: 8 }, { tee_id: 2, hole_number: 16, par: 4, stroke_index: 10 },
    { tee_id: 2, hole_number: 17, par: 5, stroke_index: 14 }, { tee_id: 2, hole_number: 18, par: 4, stroke_index: 6 },
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
    [1054,1,6],[1054,2,5],[1054,3,3],[1054,4,6],[1054,5,4],[1054,6,4],[1054,7,5],[1054,8,5],[1054,9,5],[1054,10,5],[1054,11,4],[1054,12,3],[1054,13,5],[1054,14,4],[1054,15,3],[1054,16,5],[1054,17,5],[1054,18,5],
    [1055,1,7],[1055,2,4],[1055,3,4],[1055,4,4],[1055,5,6],[1055,6,5],[1055,7,6],[1055,8,5],[1055,9,6],[1055,10,6],[1055,11,4],[1055,12,6],[1055,13,6],[1055,14,5],[1055,15,6],[1055,16,6],[1055,17,6],[1055,18,4],
    [1056,1,7],[1056,2,4],[1056,3,3],[1056,4,7],[1056,5,6],[1056,6,4],[1056,7,6],[1056,8,7],[1056,9,6],[1056,10,5],[1056,11,6],[1056,12,3],[1056,13,6],[1056,14,4],[1056,15,5],[1056,16,6],[1056,17,6],[1056,18,6],
    [1057,1,5],[1057,2,4],[1057,3,3],[1057,4,4],[1057,5,5],[1057,6,3],[1057,7,4],[1057,8,5],[1057,9,6],[1057,10,4],[1057,11,5],[1057,12,3],[1057,13,6],[1057,14,4],[1057,15,3],[1057,16,5],[1057,17,5],[1057,18,4],
    [1058,1,5],[1058,2,5],[1058,3,3],[1058,4,6],[1058,5,5],[1058,6,5],[1058,7,5],[1058,8,7],[1058,9,6],[1058,10,5],[1058,11,4],[1058,12,3],[1058,13,6],[1058,14,4],[1058,15,5],[1058,16,5],[1058,17,6],[1058,18,4],
    [1059,1,6],[1059,2,7],[1059,3,4],[1059,4,6],[1059,5,5],[1059,6,3],[1059,7,5],[1059,8,5],[1059,9,5],[1059,10,5],[1059,11,5],[1059,12,3],[1059,13,6],[1059,14,4],[1059,15,4],[1059,16,5],[1059,17,7],[1059,18,5],
    [1060,1,5],[1060,2,5],[1060,3,8],[1060,4,5],[1060,5,5],[1060,6,4],[1060,7,4],[1060,8,4],[1060,9,8],[1060,10,5],[1060,11,5],[1060,12,4],[1060,13,7],[1060,14,6],[1060,15,7],[1060,16,6],[1060,17,7],[1060,18,5],
    [1061,1,5],[1061,2,4],[1061,3,4],[1061,4,6],[1061,5,5],[1061,6,3],[1061,7,5],[1061,8,5],[1061,9,7],[1061,10,6],[1061,11,5],[1061,12,4],[1061,13,7],[1061,14,5],[1061,15,5],[1061,16,6],[1061,17,6],[1061,18,7],
    [1062,1,5],[1062,2,6],[1062,3,4],[1062,4,6],[1062,5,6],[1062,6,5],[1062,7,4],[1062,8,6],[1062,9,5],[1062,10,5],[1062,11,4],[1062,12,4],[1062,13,6],[1062,14,7],[1062,15,4],[1062,16,6],[1062,17,6],[1062,18,6],
    [1063,1,5],[1063,2,5],[1063,3,5],[1063,4,5],[1063,5,5],[1063,6,5],[1063,7,5],[1063,8,5],[1063,9,5],[1063,10,6],[1063,11,5],[1063,12,3],[1063,13,5],[1063,14,4],[1063,15,2],[1063,16,4],[1063,17,8],[1063,18,6],
    [1064,1,5],[1064,2,6],[1064,3,5],[1064,4,5],[1064,5,6],[1064,6,3],[1064,7,4],[1064,8,5],[1064,9,7],[1064,10,5],[1064,11,7],[1064,12,5],[1064,13,7],[1064,14,6],[1064,15,3],[1064,16,5],[1064,17,6],[1064,18,6],
    [1065,1,8],[1065,2,7],[1065,3,5],[1065,4,5],[1065,5,6],[1065,6,5],[1065,7,7],[1065,8,5],[1065,9,7],[1065,10,5],[1065,11,6],[1065,12,6],[1065,13,6],[1065,14,5],[1065,15,5],[1065,16,5],[1065,17,7],[1065,18,5],
    [1066,1,6],[1066,2,4],[1066,3,4],[1066,4,5],[1066,5,4],[1066,6,4],[1066,7,5],[1066,8,5],[1066,9,6],[1066,10,5],[1066,11,3],[1066,12,4],[1066,13,5],[1066,14,4],[1066,15,3],[1066,16,5],[1066,17,5],[1066,18,5],
  ],
  blind_draws: [
    { short_team_number: 1, drawn_player_id: 6, hole_range_start: 1, hole_range_end: 18 },
  ],
  payouts: [],
};
