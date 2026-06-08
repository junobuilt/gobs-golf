// E2E — homepage team-formation flow. These are the render/wiring/modal bugs
// that unit tests structurally miss (TD29): modals must actually MOUNT, the
// right buttons must render, and selecting players must route to the correct
// smartJoin outcome — not silently merge teams.
//
// Surfaces: src/app/page.tsx + PlayerPickerSheet + JoinTeamConfirmModal +
// MixedTeamsErrorModal + resolveSmartJoin (client-side).

import { test, expect, seed, seedTodayRoundWithTeams, seedNoRoundToday, TODAY_ROUND_ID } from "./support/fixtures";
import type { Page } from "@playwright/test";

const picker = (page: Page) => page.getByRole("dialog", { name: "Who's playing in this group?" });

/** Open the player picker from the homepage hero. */
async function openPicker(page: Page) {
  await page.getByRole("button", { name: "+ Form a Team" }).click();
  await expect(picker(page)).toBeVisible();
}

/** Tap a player row in the picker by their (disambiguated) display name. */
async function tapPlayer(page: Page, name: string) {
  await picker(page).getByText(name, { exact: true }).click();
}

test.beforeEach(async ({ db }) => {
  seed(db, seedTodayRoundWithTeams());
});

test("scenario 1 — create_new: self-only unassigned player forms a brand-new team", async ({ page, db }) => {
  await page.goto("/");
  await openPicker(page);

  // Dora is not yet in the round → create_new.
  await tapPlayer(page, "Dora D");
  await page.getByRole("button", { name: "Start scorecard" }).click();

  // Routes to the new team's scorecard (existing max team = 2 → new team 3),
  // and the atomic RPC fired with exactly Dora's id.
  await page.waitForURL(new RegExp(`/round/${TODAY_ROUND_ID}/scorecard\\?team=3`));
  const rpc = db.rpcCalls.find((c) => c.name === "create_team_with_players");
  expect(rpc, "create_team_with_players RPC should fire").toBeTruthy();
  expect(rpc!.args.p_player_ids).toEqual([4]);
});

test("scenario 2 — silent_join: selecting a player already on a team joins it with no modal", async ({ page, db }) => {
  await page.goto("/");
  await openPicker(page);

  // Adam is on Team 1 → silent_join, straight to Team 1's scorecard.
  await tapPlayer(page, "Adam A");
  await page.getByRole("button", { name: "Start scorecard" }).click();

  await page.waitForURL(new RegExp(`/round/${TODAY_ROUND_ID}/scorecard\\?team=1`));
  // No confirm/mixed modal, and no team-creation RPC.
  await expect(page.getByRole("dialog", { name: /Join Team/ })).toHaveCount(0);
  expect(db.rpcCalls.find((c) => c.name === "create_team_with_players")).toBeFalsy();
});

test("scenario 3 — confirm_join: two-button modal renders, Cancel returns, Add joins the team", async ({ page, db }) => {
  await page.goto("/");
  await openPicker(page);

  // Unassigned Dora + already-assigned Adam (Team 1) → confirm_join Team 1.
  await tapPlayer(page, "Adam A");
  await tapPlayer(page, "Dora D");
  await page.getByRole("button", { name: "Start scorecard" }).click();

  // BOTH options of the two-button modal must render.
  const confirm = page.getByRole("dialog", { name: "Join Team 1" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText("Join Team 1?")).toBeVisible();
  const addBtn = confirm.getByRole("button", { name: "Add to Team 1" });
  const cancelBtn = confirm.getByRole("button", { name: "Cancel" });
  await expect(addBtn).toBeVisible();
  await expect(cancelBtn).toBeVisible();

  // Cancel returns to the picker with the selection preserved (no DB change).
  await cancelBtn.click();
  await expect(confirm).toBeHidden();
  await expect(picker(page)).toBeVisible();
  expect(db.tables.round_players.some((rp) => rp.player_id === 4)).toBe(false);

  // Re-confirm and Add → Dora is written onto Team 1, route to Team 1.
  await page.getByRole("button", { name: "Start scorecard" }).click();
  await page.getByRole("dialog", { name: "Join Team 1" }).getByRole("button", { name: "Add to Team 1" }).click();

  await page.waitForURL(new RegExp(`/round/${TODAY_ROUND_ID}/scorecard\\?team=1`));
  const dora = db.tables.round_players.find((rp) => rp.player_id === 4);
  expect(dora, "Dora should be added to round_players").toBeTruthy();
  expect(dora!.team_number).toBe(1);
});

test("scenario 4 — mixed_teams_error: selecting two already-assigned players surfaces the error, no silent merge", async ({ page, db }) => {
  await page.goto("/");
  await openPicker(page);

  // Adam (Team 1) + Carl (Team 2) → cannot mix.
  await tapPlayer(page, "Adam A");
  await tapPlayer(page, "Carl C");
  await page.getByRole("button", { name: "Start scorecard" }).click();

  const mixed = page.getByRole("dialog", { name: "Mixed teams error" });
  await expect(mixed).toBeVisible();
  await expect(mixed.getByText("Can't mix teams")).toBeVisible();

  // Nothing was merged: Adam stays Team 1, Carl stays Team 2, no RPC.
  expect(db.tables.round_players.find((rp) => rp.player_id === 1)!.team_number).toBe(1);
  expect(db.tables.round_players.find((rp) => rp.player_id === 3)!.team_number).toBe(2);
  expect(db.rpcCalls.find((c) => c.name === "create_team_with_players")).toBeFalsy();

  // Dismiss returns to the picker.
  await mixed.getByRole("button", { name: "Adjust selection" }).click();
  await expect(mixed).toBeHidden();
  await expect(picker(page)).toBeVisible();
});

test("scenario 5a — empty state: no round today shows the empty message and Form a Team CTA", async ({ page, db }) => {
  seed(db, seedNoRoundToday());
  await page.goto("/");

  await expect(page.getByText("No teams exist yet.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Form a Team" })).toBeVisible();
});
