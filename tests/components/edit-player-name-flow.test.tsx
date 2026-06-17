// @vitest-environment jsdom
//
// Admin → Players: Edit Player Name flow.
//
// Covers:
//   - Editor opens pre-filled with full_name (required) + display_name
//     (optional); mirrors the Add Player form's two name fields.
//   - Save writes full_name + display_name to the players row for the RIGHT id
//     only (negative control: editing player A issues exactly one players
//     update filtered to A; player B's row is never written and is unchanged).
//   - Blank full_name disables Save (same validation as Add).
//
// No HI write, no cascade, no migration — a rename is a single players UPDATE.
// Names are never snapshotted (see results-rename-history.test.ts for the
// history-intact proof).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { FakeSupabase, type FakeData } from "./fake-supabase";

const fakeRef = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));

vi.mock("@/lib/supabase", () => ({
  get supabase() { return fakeRef.current; },
}));

import Players from "@/app/admin/tabs/Players";
import type { Player } from "@/app/admin/page";

const PLAYER_A: Player = {
  id: 1, full_name: "Mike Williams", display_name: "Mikey",
  handicap_index: 10, is_active: true, preferred_tee_id: 1,
};
const PLAYER_B: Player = {
  id: 2, full_name: "Bob Brown", display_name: null,
  handicap_index: 12, is_active: true, preferred_tee_id: 1,
};

// Players only ever writes to the players table; the other keys are unused but
// required by the FakeData shape.
function seed(): FakeData {
  return {
    rounds: [], tees: [], holes: [], round_players: [], scores: [],
    players: [{ ...PLAYER_A }, { ...PLAYER_B }],
  };
}

async function flush(rounds = 8) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

function renderPlayers() {
  const onRefresh = vi.fn();
  render(<Players players={[PLAYER_A, PLAYER_B]} onRefresh={onRefresh} />);
  return { onRefresh };
}

beforeEach(() => {
  fakeRef.current = new FakeSupabase(seed());
});

afterEach(() => {
  cleanup();
});

describe("Players — Edit Player Name", () => {
  it("opens the editor pre-filled with full_name + display_name", async () => {
    renderPlayers();
    expect(screen.queryByTestId("edit-name-form")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("edit-name-link-1"));
    });

    expect(screen.getByTestId("edit-name-form")).toBeInTheDocument();
    expect((screen.getByTestId("edit-name-fullname") as HTMLInputElement).value).toBe("Mike Williams");
    expect((screen.getByTestId("edit-name-displayname") as HTMLInputElement).value).toBe("Mikey");
  });

  it("Save writes full_name + display_name to the right id only", async () => {
    const { onRefresh } = renderPlayers();

    await act(async () => {
      fireEvent.click(screen.getByTestId("edit-name-link-1"));
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("edit-name-fullname"), { target: { value: "Michael Williams" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("edit-name-save"));
      await flush();
    });

    const playerWrites = fakeRef.current.writes.filter(w => w.table === "players");
    expect(playerWrites).toHaveLength(1);
    const write = playerWrites[0] as { type: string; filters: any[]; payload: any };
    expect(write.type).toBe("update");
    expect(write.filters.some(f => f[0] === "id" && f[1] === 1)).toBe(true);
    // Negative control: nothing targets player B.
    expect(write.filters.some(f => f[0] === "id" && f[1] === 2)).toBe(false);
    expect(write.payload).toEqual({ full_name: "Michael Williams", display_name: "Mikey" });

    // Player B's row is untouched in the fake DB.
    const bRow = fakeRef.current.data.players.find((p: any) => p.id === 2);
    expect(bRow.full_name).toBe("Bob Brown");
    expect(bRow.display_name).toBeNull();

    expect(onRefresh).toHaveBeenCalledTimes(1);
    // Editor closes after save.
    expect(screen.queryByTestId("edit-name-form")).toBeNull();
  });

  it("persists null display_name when the optional field is blank", async () => {
    renderPlayers();

    await act(async () => {
      fireEvent.click(screen.getByTestId("edit-name-link-2"));
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("edit-name-fullname"), { target: { value: "Robert Brown" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("edit-name-save"));
      await flush();
    });

    const write = fakeRef.current.writes.find(w => w.table === "players") as { payload: any };
    expect(write.payload).toEqual({ full_name: "Robert Brown", display_name: null });
  });

  it("disables Save when full_name is blank", async () => {
    renderPlayers();

    await act(async () => {
      fireEvent.click(screen.getByTestId("edit-name-link-1"));
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("edit-name-fullname"), { target: { value: "   " } });
    });

    expect((screen.getByTestId("edit-name-save") as HTMLButtonElement).disabled).toBe(true);

    // Clicking the disabled Save issues no write.
    await act(async () => {
      fireEvent.click(screen.getByTestId("edit-name-save"));
      await flush();
    });
    expect(fakeRef.current.writes.filter(w => w.table === "players")).toHaveLength(0);
  });
});
