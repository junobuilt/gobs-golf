// Non-DOM test for A1.7's PlayerHoleGrid. Uses react-dom/server's
// renderToString so we don't depend on jsdom — STATUS.md flags
// jsdom-dependent tests as flaky on master, and the source of truth is
// non-DOM.

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";
import PlayerHoleGrid from "@/components/scorecard/PlayerHoleGrid";

const PAR_18 = [4, 4, 4, 3, 5, 4, 3, 5, 4, 4, 4, 3, 5, 4, 3, 5, 4, 4];
const ALL_NULL: (number | null)[] = Array(18).fill(null);

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const next = haystack.indexOf(needle, idx);
    if (next === -1) return count;
    count += 1;
    idx = next + needle.length;
  }
}

describe("PlayerHoleGrid", () => {
  it("renders an em-dash for every unplayed hole + both subtotals", () => {
    const html = renderToString(
      <PlayerHoleGrid scores={ALL_NULL} par={PAR_18} />
    );
    // 18 score cells + F9 subtotal + B9 subtotal + Total line = 21
    expect(countOccurrences(html, "—")).toBe(21);
  });

  it("renders gross score numerals when holes are played", () => {
    const scores = [...ALL_NULL];
    scores[0] = 5;
    scores[9] = 6;
    const html = renderToString(
      <PlayerHoleGrid scores={scores} par={PAR_18} />
    );
    expect(html).toMatch(/>5</);
    expect(html).toMatch(/>6</);
  });

  it("uses the birdie color #3B6D11 when score < par for a played hole", () => {
    const scores = [...ALL_NULL];
    scores[0] = 3; // par 4 → birdie
    const html = renderToString(
      <PlayerHoleGrid scores={scores} par={PAR_18} />
    );
    expect(html).toContain("#3B6D11");
  });

  it("does NOT paint birdie color when no played hole beats par", () => {
    const scores = [...ALL_NULL];
    scores[0] = 5; // par 4 → bogey
    scores[3] = 3; // par 3 → par, not birdie
    const html = renderToString(
      <PlayerHoleGrid scores={scores} par={PAR_18} />
    );
    expect(html).not.toContain("#3B6D11");
  });

  it("highlights the current hole header + score when currentHoleIndex is set", () => {
    const scores = [...ALL_NULL];
    scores[2] = 5;
    const html = renderToString(
      <PlayerHoleGrid scores={scores} par={PAR_18} currentHoleIndex={2} />
    );
    // Two highlighted cells (header + score) for hole index 2.
    expect(countOccurrences(html, "#dbeafe")).toBe(2);
  });

  it("omits the highlight entirely when currentHoleIndex is undefined", () => {
    const html = renderToString(
      <PlayerHoleGrid scores={ALL_NULL} par={PAR_18} />
    );
    expect(html).not.toContain("#dbeafe");
  });

  it("renders the bottom Total line by default and shows the sum", () => {
    const scores = [...ALL_NULL];
    scores[0] = 5;
    scores[9] = 6;
    const html = renderToString(
      <PlayerHoleGrid scores={scores} par={PAR_18} />
    );
    // "Total " text followed by 11 in a span
    expect(html).toContain("Total");
    expect(html).toMatch(/>11</);
  });

  it("hides the bottom Total line when showRunningTotal=false (C PR3 path)", () => {
    const scores = [...ALL_NULL];
    scores[0] = 5;
    const html = renderToString(
      <PlayerHoleGrid
        scores={scores}
        par={PAR_18}
        showRunningTotal={false}
      />
    );
    expect(html).not.toContain("Total");
  });

  it("renders the F9 and B9 subtotal labels", () => {
    const html = renderToString(
      <PlayerHoleGrid scores={ALL_NULL} par={PAR_18} />
    );
    expect(html).toContain("F9");
    expect(html).toContain("B9");
  });

  it("computes F9 par subtotal = sum of first 9 par values", () => {
    const html = renderToString(
      <PlayerHoleGrid scores={ALL_NULL} par={PAR_18} />
    );
    const f9Par = PAR_18.slice(0, 9).reduce((a, b) => a + b, 0); // 36
    const b9Par = PAR_18.slice(9).reduce((a, b) => a + b, 0); // 36
    expect(html).toMatch(new RegExp(`>${f9Par}<`));
    expect(html).toMatch(new RegExp(`>${b9Par}<`));
  });

  it("subtotal shows played-hole sum, not par-padded sum", () => {
    const scores = [...ALL_NULL];
    scores[0] = 5;
    scores[1] = 4;
    // Only 2 holes played in F9; F9 subtotal should be 9 (not 9 + remaining pars).
    const html = renderToString(
      <PlayerHoleGrid scores={scores} par={PAR_18} />
    );
    expect(html).toMatch(/>9</);
  });
});
