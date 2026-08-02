// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { getStoredPlayerId, setStoredPlayerId, clearStoredPlayerId } from "@/lib/deviceMemory";

beforeEach(() => {
  window.localStorage.clear();
});

describe("deviceMemory", () => {
  it("stores and reads back a player_id", () => {
    expect(getStoredPlayerId()).toBeNull();
    setStoredPlayerId(42);
    expect(getStoredPlayerId()).toBe(42);
  });

  it("clear removes the stored id", () => {
    setStoredPlayerId(7);
    clearStoredPlayerId();
    expect(getStoredPlayerId()).toBeNull();
  });

  it("returns null for a missing / non-numeric / non-positive value", () => {
    expect(getStoredPlayerId()).toBeNull();
    window.localStorage.setItem("gobs:tournament-player-id", "abc");
    expect(getStoredPlayerId()).toBeNull();
    window.localStorage.setItem("gobs:tournament-player-id", "0");
    expect(getStoredPlayerId()).toBeNull();
  });
});
