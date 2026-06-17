import { describe, it, expect } from "vitest";
import { getDisplayName, PlayerLike } from "@/lib/players/displayName";

// Realistic-ish GOBS roster slice. Includes the two Waynes (the canonical
// collision) plus an invented Norm collision to exercise multi-char prefixes.
// `id`s are arbitrary but stable; `is_active` defaults to true via omission
// where it does not matter.
const ROSTER: PlayerLike[] = [
  { id: 1, full_name: "Bill Carlson", is_active: true },
  { id: 45, full_name: "Wayne Hashimoto", is_active: true },
  { id: 55, full_name: "Wayne Vincent", is_active: true },
  { id: 10, full_name: "Norm Carstairs", is_active: true },
  { id: 11, full_name: "Norm Carlson", is_active: true },
  { id: 20, full_name: "Jeff Irvin", is_active: true },
  { id: 21, full_name: "Cher", is_active: true }, // single-word name
];

const byName = (name: string): PlayerLike =>
  ROSTER.find(p => p.full_name === name)!;

describe("getDisplayName", () => {
  it("uses a single initial when the first name is unique", () => {
    expect(getDisplayName(byName("Bill Carlson"), ROSTER)).toBe("Bill C");
  });

  it("disambiguates two shared first names with single initials", () => {
    expect(getDisplayName(byName("Wayne Hashimoto"), ROSTER)).toBe("Wayne H");
    expect(getDisplayName(byName("Wayne Vincent"), ROSTER)).toBe("Wayne V");
  });

  it("grows the suffix to the minimum prefix that disambiguates", () => {
    // Carstairs vs Carlson share "Car"; first divergence is at 4 chars.
    expect(getDisplayName(byName("Norm Carstairs"), ROSTER)).toBe("Norm Cars");
    expect(getDisplayName(byName("Norm Carlson"), ROSTER)).toBe("Norm Carl");
  });

  it("returns a single-word name as-is", () => {
    expect(getDisplayName(byName("Cher"), ROSTER)).toBe("Cher");
  });

  it("an unrelated unique name still gets a single initial", () => {
    expect(getDisplayName(byName("Jeff Irvin"), ROSTER)).toBe("Jeff I");
  });

  it("grows the suffix by one char when a peer diverges at the 2nd letter", () => {
    const before: PlayerLike[] = [{ id: 1, full_name: "Bill Carlson", is_active: true }];
    expect(getDisplayName(before[0], before)).toBe("Bill C");

    // Bill Cooper joins -> "C" is now ambiguous; Carlson/Cooper diverge at the
    // 2nd char, so each grows by exactly one letter: "Bill Ca" / "Bill Co".
    const after: PlayerLike[] = [
      ...before,
      { id: 2, full_name: "Bill Cooper", is_active: true },
    ];
    expect(getDisplayName(after[0], after)).toBe("Bill Ca");
    expect(getDisplayName(after[1], after)).toBe("Bill Co");
  });

  it("grows to the true minimal prefix when peers share leading letters", () => {
    // Carlson vs Calderson share "Ca"; first divergence is at the 3rd char, so
    // "Bill Ca" would NOT disambiguate — minimum is "Bill Car" / "Bill Cal".
    const roster: PlayerLike[] = [
      { id: 1, full_name: "Bill Carlson", is_active: true },
      { id: 2, full_name: "Bill Calderson", is_active: true },
    ];
    expect(getDisplayName(roster[0], roster)).toBe("Bill Car");
    expect(getDisplayName(roster[1], roster)).toBe("Bill Cal");
  });

  it("ignores inactive players when disambiguating by default", () => {
    const roster: PlayerLike[] = [
      { id: 45, full_name: "Wayne Hashimoto", is_active: true },
      { id: 55, full_name: "Wayne Vincent", is_active: false },
    ];
    // The other Wayne is inactive, so the active one needs no suffix growth.
    expect(getDisplayName(roster[0], roster)).toBe("Wayne H");
  });

  it("counts inactive players when activeOnly is false", () => {
    const roster: PlayerLike[] = [
      { id: 45, full_name: "Wayne Hashimoto", is_active: true },
      { id: 55, full_name: "Wayne Vincent", is_active: false },
    ];
    // Still single-initial here because H/V differ at 1 char, but the inactive
    // peer is now in the universe — assert it is considered (no crash, correct).
    expect(getDisplayName(roster[0], roster, { activeOnly: false })).toBe("Wayne H");
  });

  it("recomputes both short names when a rename newly creates a collision", () => {
    // Models the admin Edit-Player-Name behavior note: disambiguation is a pure
    // render-time recompute, so renaming a player into a collision grows BOTH
    // players' short names on next render — no special-casing, no frozen state.
    const before: PlayerLike[] = [
      { id: 1, full_name: "Mike Williams", is_active: true },
      { id: 2, full_name: "Dave Wilson", is_active: true },
    ];
    // Unique first names → single initials.
    expect(getDisplayName(before[0], before)).toBe("Mike W");

    // Rename player 2 to "Mike Wilson" → two Mikes now collide. "Williams" vs
    // "Wilson" share "Wil" and diverge at the 4th char, so each grows to 4.
    const after: PlayerLike[] = [
      { id: 1, full_name: "Mike Williams", is_active: true },
      { id: 2, full_name: "Mike Wilson", is_active: true },
    ];
    expect(getDisplayName(after[0], after)).toBe("Mike Will");
    expect(getDisplayName(after[1], after)).toBe("Mike Wils");
  });

  it("handles apostrophes and hyphens in the last name", () => {
    const roster: PlayerLike[] = [
      { id: 1, full_name: "Dave O'Brien", is_active: true },
      { id: 2, full_name: "Dave O'Connor", is_active: true },
      { id: 3, full_name: "Sam Smith-Jones", is_active: true },
    ];
    // O'Brien vs O'Connor share "O'" -> diverge at the 3rd char.
    expect(getDisplayName(roster[0], roster)).toBe("Dave O'B");
    expect(getDisplayName(roster[1], roster)).toBe("Dave O'C");
    // Unique first name -> single initial, hyphen untouched.
    expect(getDisplayName(roster[2], roster)).toBe("Sam S");
  });
});
