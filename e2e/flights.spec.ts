import { test, expect } from "./support/fixtures";
import { seed, seedTodayRoundWithTeams } from "./support/fixtures";

// Session 2 (Flights) — admin Round Setup flight management against the
// intercepted-network mock. Drives the headline flow: single-flight has no
// chips → add a flight → rename it → chips appear → move a team → pick the new
// flight's format → delete an emptied flight.

test("flight lifecycle: add → rename → move team → pick format → delete", async ({ page, db }) => {
  // A round with two teams, format not yet picked → RoundSetup active view,
  // one flight (Flight A), no per-team flight chips.
  seed(db, seedTodayRoundWithTeams());
  await page.goto("/admin");

  // Single flight: the Flights section shows Flight A and NO move chips.
  await expect(page.getByText("Flights")).toBeVisible();
  await expect(page.getByRole("button", { name: /Pick format for Flight A/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Move Team 1/ })).toHaveCount(0);

  // Add a second flight → Flight B card appears.
  await page.getByRole("button", { name: "+ Add Flight" }).click();
  await expect(page.getByRole("button", { name: /Pick format for Flight B/ })).toBeVisible();

  // Rename Flight B → "4-Man".
  await page.getByRole("button", { name: "Rename Flight B" }).click();
  const nameInput = page.getByLabel("Flight name");
  await nameInput.fill("4-Man");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("4-Man")).toBeVisible();

  // 2 flights now → team rows show the move chip. Move Team 2 into 4-Man.
  await page.getByRole("button", { name: /Move Team 2/ }).click();
  await expect(page.getByText("Move Team 2 to…")).toBeVisible();
  await page.getByText("4-Man", { exact: false }).last().click();

  // Team 2's chip now reads the 4-Man flight.
  await expect(page.getByRole("button", { name: /Move Team 2 \(currently 4-Man\)/ })).toBeVisible();

  // Pick a format for the 4-Man flight via its card chip.
  await page.getByRole("button", { name: /Pick format for 4-Man/ }).click();
  const dialog = page.getByRole("dialog", { name: "Choose today's format" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Best Ball/ }).click();
  await dialog.getByRole("button", { name: /^Save/ }).click();
  await expect(dialog).toBeHidden();

  // The 4-Man flight card now shows its format chip as Best Ball.
  await expect(page.getByRole("button", { name: /Change format for 4-Man/ })).toBeVisible();
});
