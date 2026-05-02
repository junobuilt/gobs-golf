export const TEAM_COLORS = [
  { border: "#276e34", bg: "#f3faf5", pillBg: "#e4f5e9", pillText: "#276e34" },
  { border: "#b87020", bg: "#fdf7ee", pillBg: "#fdeedd", pillText: "#8c5010" },
  { border: "#aaaaaa", bg: "#f8f8f8", pillBg: "#efefef", pillText: "#888888" },
  { border: "#1a6fa8", bg: "#eef5fc", pillBg: "#deeefa", pillText: "#1a5a8c" },
  { border: "#8b2fc9", bg: "#f6eefe", pillBg: "#eeddf8", pillText: "#6a1fa8" },
  { border: "#c0392b", bg: "#fdf0ee", pillBg: "#fde0dc", pillText: "#9a2a20" },
  { border: "#1a8c7a", bg: "#eef8f6", pillBg: "#d8f2ed", pillText: "#136858" },
  { border: "#c47d00", bg: "#fef9ee", pillBg: "#fdf0cc", pillText: "#9a6000" },
  { border: "#2b5ba8", bg: "#eef1fa", pillBg: "#dde4f8", pillText: "#1e3f80" },
  { border: "#a04020", bg: "#faf0eb", pillBg: "#f5ddd0", pillText: "#7a2e14" },
  { border: "#5a7a20", bg: "#f2f7e8", pillBg: "#e4efd0", pillText: "#3e5a14" },
  { border: "#6a4a9a", bg: "#f4f0fa", pillBg: "#e8dff5", pillText: "#4e2e7a" },
];

export function getTeamColor(teamNum: number) {
  return TEAM_COLORS[(teamNum - 1) % TEAM_COLORS.length];
}
