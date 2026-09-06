// @vitest-environment jsdom
/**
 * Backup Admin Access card (v2 — named holders), in admin Settings.
 *
 * The credential DATA path is server-side and is covered by vitest at the
 * action/primitive layer (backupActions, backupLogin, backupPin, adminAuth-
 * backup, middleware-backup). What lives ONLY here is the render layer, and one
 * rule in particular that has no other home:
 *
 *   "Unnamed (pre-upgrade)" is branded off `holderName === null`, NOT off
 *   `playerId === null`.
 *
 * That distinction is load-bearing. `admin_backup_pin.player_id` is FK'd
 * ON DELETE SET NULL, so removing a player from the roster nulls player_id while
 * the holder_name snapshot survives — which is exactly why the snapshot column
 * exists. Branding off player_id would silently relabel a real, named holder as
 * "Unnamed (pre-upgrade)" and leave the admin unable to tell who is holding a
 * live credential.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  holders: [] as Record<string, unknown>[],
  revoked: [] as number[],
  minted: [] as FormData[],
}));

vi.mock("@/app/admin/settings/backupActions", () => ({
  listBackupPins: async () => h.holders,
  revokeBackupPin: async (id: number) => {
    h.revoked.push(id);
    h.holders = h.holders.filter((r) => r.id !== id);
    return { ok: true };
  },
  mintBackupPin: async (_prev: unknown, fd: FormData) => {
    h.minted.push(fd);
    return {
      ok: true,
      pin: String(fd.get("pin")),
      holderName: "John Doe",
      expiresAt: "2027-08-30T06:59:59.999Z",
    };
  },
}));

// Settings' other panels aren't under test — keep them out of the way.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        update: () => chain,
        upsert: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
      };
      return chain;
    },
  },
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

// Sibling Settings panel — pulls useRouter (no app router in jsdom) and is not
// under test here.
vi.mock("@/app/admin/components/SeasonManagement", () => ({
  default: () => null,
}));

import Settings from "@/app/admin/tabs/Settings";
import type { Player } from "@/app/admin/page";

const PLAYERS: Player[] = [
  { id: 1, full_name: "John Doe", display_name: "John D", handicap_index: 10, is_active: true, preferred_tee_id: 1 },
  { id: 2, full_name: "Mary Roe", display_name: "Mary R", handicap_index: 12, is_active: true, preferred_tee_id: 1 },
];

async function renderCard() {
  await act(async () => {
    render(<Settings settings={{ buy_in_amount: "10" }} onRefresh={() => {}} players={PLAYERS} />);
  });
}

beforeEach(() => {
  h.holders = [];
  h.revoked.length = 0;
  h.minted.length = 0;
});

afterEach(cleanup);

describe("Backup Admin Access — assigned PINs list", () => {
  it("shows the empty state when nobody holds a PIN", async () => {
    await renderCard();
    expect(screen.getByText("No PINs assigned.")).toBeTruthy();
  });

  it("lists each holder with name and a plain calendar expiry", async () => {
    h.holders = [
      { id: 1, holderName: "Mary Roe", playerId: 2, expiresAt: "2027-08-30T06:59:59.999Z", createdAt: "2026-09-01T00:00:00.000Z" },
      { id: 2, holderName: "John Doe", playerId: 1, expiresAt: "2027-09-30T06:59:59.999Z", createdAt: "2026-09-01T00:00:00.000Z" },
    ];
    await renderCard();

    expect(screen.getByText("Mary Roe")).toBeTruthy();
    expect(screen.getByText("John Doe")).toBeTruthy();
    expect(screen.getByText("Expires August 29, 2027")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
  });

  it("brands a PRE-UPGRADE credential (no name snapshot) and shows its created date", async () => {
    h.holders = [
      { id: 7, holderName: null, playerId: null, expiresAt: "2026-09-07T07:26:06.206Z", createdAt: "2026-08-31T07:26:06.457Z" },
    ];
    await renderCard();

    expect(screen.getByText("Unnamed (pre-upgrade)")).toBeTruthy();
    // The created date is the only handle the admin has on who this is.
    expect(screen.getByText("Created August 31, 2026")).toBeTruthy();
  });

  it("KEEPS a removed player's name — null playerId alone is not pre-upgrade", async () => {
    // Player row deleted; FK nulled player_id, holder_name snapshot survived.
    h.holders = [
      { id: 9, holderName: "John Doe", playerId: null, expiresAt: "2027-08-30T06:59:59.999Z", createdAt: "2026-09-01T00:00:00.000Z" },
    ];
    await renderCard();

    expect(screen.getByText("John Doe")).toBeTruthy();
    expect(screen.queryByText("Unnamed (pre-upgrade)")).toBeNull();
  });
});

describe("Backup Admin Access — removing a holder", () => {
  it("confirms by name and date before revoking, and revokes only that one", async () => {
    h.holders = [
      { id: 5, holderName: "John Doe", playerId: 1, expiresAt: "2027-08-30T06:59:59.999Z", createdAt: "2026-09-01T00:00:00.000Z" },
      { id: 6, holderName: "Mary Roe", playerId: 2, expiresAt: "2027-09-30T06:59:59.999Z", createdAt: "2026-09-01T00:00:00.000Z" },
    ];
    await renderCard();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);

    expect(
      screen.getByText("Remove admin access for John Doe (expires August 29, 2027)?")
    ).toBeTruthy();

    // DangerModal holds Confirm disabled for 1.5s and labels it "Wait…" until
    // then (the repo's dangerous-action pattern) — so wait it out, then confirm.
    const confirm = screen.getByTestId("danger-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1600));
    });
    expect(confirm.textContent).toBe("Remove access");
    await act(async () => {
      fireEvent.click(confirm);
    });

    expect(h.revoked).toEqual([5]);
    expect(screen.getByText("Mary Roe")).toBeTruthy();
    expect(screen.queryByText("John Doe")).toBeNull();
  });

  it("cancelling revokes nothing", async () => {
    h.holders = [
      { id: 5, holderName: "John Doe", playerId: 1, expiresAt: "2027-08-30T06:59:59.999Z", createdAt: "2026-09-01T00:00:00.000Z" },
    ];
    await renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByTestId("danger-cancel"));

    expect(h.revoked).toEqual([]);
    expect(screen.getByText("John Doe")).toBeTruthy();
  });
});

describe("Backup Admin Access — assign form", () => {
  it("bounds the date picker to today..one year out", async () => {
    await renderCard();
    const date = document.querySelector<HTMLInputElement>("#backup-pin-expiry")!;
    expect(date.type).toBe("date");

    const min = date.min;
    const max = date.max;
    expect(min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // min is TODAY, not tomorrow — a same-day PIN must be possible.
    expect(min).toBe(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Vancouver",
        year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date())
    );
    expect(Number(max.slice(0, 4))).toBe(Number(min.slice(0, 4)) + 1);
  });

  it("requires a player before assigning", async () => {
    await renderCard();
    fireEvent.change(document.querySelector<HTMLInputElement>("#backup-pin-digits")!, {
      target: { value: "1234" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Assign PIN" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("Choose who this PIN is for.");
    expect(h.minted).toHaveLength(0);
  });

  it("assigns, then reveals the PIN once with the holder and expiry", async () => {
    await renderCard();

    // Pick the player through the real combobox.
    fireEvent.focus(screen.getByLabelText("Who is it for?"));
    fireEvent.click(screen.getByRole("option", { name: "John Doe" }));
    fireEvent.change(document.querySelector<HTMLInputElement>("#backup-pin-digits")!, {
      target: { value: "4821" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Assign PIN" }));
    });

    expect(h.minted).toHaveLength(1);
    expect(h.minted[0].get("player_id")).toBe("1");
    expect(h.minted[0].get("pin")).toBe("4821");

    // Reveal panel: PIN + holder + expiry, and it can't be looked up later.
    expect(screen.getByText("4821")).toBeTruthy();
    expect(screen.getByText("PIN assigned to John Doe")).toBeTruthy();
    expect(screen.getByText("Works through August 29, 2027")).toBeTruthy();

    // Dismiss — and it is not shown again.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Done — I.ve saved it/ }));
    });
    expect(screen.queryByText("4821")).toBeNull();
  });
});
