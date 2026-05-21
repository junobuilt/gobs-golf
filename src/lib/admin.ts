"use client";

// Admin URL flag + round edit mode helpers.
//
// Finalized rounds are read-only by default. Admins unlock edit mode in
// two steps:
//   1. Land on the round URL with ?admin=1 (sticky across navigation).
//   2. Tap "Edit Round Scores" → DangerModal → confirm flips ?edit=1 on.
//
// Both flags live in the URL so edit mode survives summary ↔ scorecard
// navigation within a round. useSearchParams() (reactive) drives reads;
// router.replace() drives writes while preserving every other param the
// page may carry (e.g. ?team=N on the scorecard).

import { useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";

export function useIsAdmin(): boolean {
  return useSearchParams().get("admin") === "1";
}

export function useIsRoundEditMode(): boolean {
  return useSearchParams().get("edit") === "1";
}

interface RouterLike {
  replace: (href: string) => void;
}

/**
 * Build a query string that mutates the given param while preserving every
 * other current param. Returns just the search portion (e.g. "?admin=1&edit=1").
 */
export function buildSearchString(
  current: ReadonlyURLSearchParams | URLSearchParams | null | undefined,
  changes: Record<string, string | null>,
): string {
  const next = new URLSearchParams(current?.toString() ?? "");
  for (const [key, val] of Object.entries(changes)) {
    if (val === null) next.delete(key);
    else next.set(key, val);
  }
  const s = next.toString();
  return s ? `?${s}` : "";
}

export function enterRoundEditMode(
  router: RouterLike,
  pathname: string,
  current: ReadonlyURLSearchParams | URLSearchParams | null | undefined,
): void {
  router.replace(`${pathname}${buildSearchString(current, { admin: "1", edit: "1" })}`);
}

export function exitRoundEditMode(
  router: RouterLike,
  pathname: string,
  current: ReadonlyURLSearchParams | URLSearchParams | null | undefined,
): void {
  router.replace(`${pathname}${buildSearchString(current, { edit: null })}`);
}

/**
 * Append the current admin/edit flags to a relative href so navigation
 * between round-scoped pages (summary ↔ scorecard) keeps edit mode alive.
 * Leaves the href unchanged when neither flag is set.
 */
export function withAdminFlags(
  href: string,
  current: ReadonlyURLSearchParams | URLSearchParams | null | undefined,
): string {
  const admin = current?.get("admin");
  const edit = current?.get("edit");
  if (admin !== "1" && edit !== "1") return href;
  const [path, existing] = href.split("?", 2);
  const params = new URLSearchParams(existing ?? "");
  if (admin === "1") params.set("admin", "1");
  if (edit === "1") params.set("edit", "1");
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}
