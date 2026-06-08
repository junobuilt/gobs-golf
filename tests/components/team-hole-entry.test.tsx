// @vitest-environment jsdom
/**
 * Wave 1B C2 — TeamHoleEntry per-hole team-card stepper.
 *
 * Verifies the A6 dash-until-tap par-anchor, the 1..20 range guard, count-1 vs
 * count-2 rendering, the summed hole total, and the disabled state. Fixtures
 * start UNSCORED so the par-anchor must do real work for the assertions to hold.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import TeamHoleEntry from "@/components/scorecard/TeamHoleEntry";

afterEach(() => cleanup());

describe("TeamHoleEntry — dash-until-tap, par-anchored", () => {
  it("shows '—' until the first tap, then lands on par", () => {
    const onSet = vi.fn();
    render(<TeamHoleEntry ballCount={1} balls={[undefined]} par={4} onSet={onSet} />);
    // Negative control: unentered renders the em-dash, not a number.
    expect(screen.getByTestId("ball-1-value").textContent).toBe("—");
    fireEvent.click(screen.getByTestId("ball-1-plus"));
    expect(onSet).toHaveBeenCalledWith(1, 4); // first tap → par
  });

  it("first '−' tap also lands on par", () => {
    const onSet = vi.fn();
    render(<TeamHoleEntry ballCount={1} balls={[undefined]} par={3} onSet={onSet} />);
    fireEvent.click(screen.getByTestId("ball-1-minus"));
    expect(onSet).toHaveBeenCalledWith(1, 3);
  });

  it("increments / decrements from the current value", () => {
    const onSet = vi.fn();
    const { rerender } = render(<TeamHoleEntry ballCount={1} balls={[4]} par={4} onSet={onSet} />);
    fireEvent.click(screen.getByTestId("ball-1-plus"));
    expect(onSet).toHaveBeenLastCalledWith(1, 5);
    rerender(<TeamHoleEntry ballCount={1} balls={[4]} par={4} onSet={onSet} />);
    fireEvent.click(screen.getByTestId("ball-1-minus"));
    expect(onSet).toHaveBeenLastCalledWith(1, 3);
  });

  it("guards the 1..20 range (no onSet at the bounds)", () => {
    const onSet = vi.fn();
    const { rerender } = render(<TeamHoleEntry ballCount={1} balls={[20]} par={4} onSet={onSet} />);
    fireEvent.click(screen.getByTestId("ball-1-plus")); // 20 + 1 → blocked
    expect(onSet).not.toHaveBeenCalled();
    rerender(<TeamHoleEntry ballCount={1} balls={[1]} par={4} onSet={onSet} />);
    fireEvent.click(screen.getByTestId("ball-1-minus")); // 1 − 1 → blocked
    expect(onSet).not.toHaveBeenCalled();
  });
});

describe("TeamHoleEntry — count-2", () => {
  it("renders two steppers and a summed hole total", () => {
    const onSet = vi.fn();
    render(<TeamHoleEntry ballCount={2} balls={[4, 5]} par={4} onSet={onSet} />);
    expect(screen.getByTestId("ball-1-value").textContent).toBe("4");
    expect(screen.getByTestId("ball-2-value").textContent).toBe("5");
    expect(screen.getByTestId("hole-total").textContent).toContain("9"); // 4 + 5
  });

  it("hole total shows '—' when nothing entered, and each ball anchors to par", () => {
    const onSet = vi.fn();
    render(<TeamHoleEntry ballCount={2} balls={[undefined, undefined]} par={5} onSet={onSet} />);
    expect(screen.getByTestId("hole-total").textContent).toContain("—");
    fireEvent.click(screen.getByTestId("ball-2-plus"));
    expect(onSet).toHaveBeenCalledWith(2, 5); // ball 2 first tap → par
  });
});

describe("TeamHoleEntry — disabled", () => {
  it("does not fire onSet and disables the steppers", () => {
    const onSet = vi.fn();
    render(<TeamHoleEntry ballCount={1} balls={[undefined]} par={4} disabled onSet={onSet} />);
    const plus = screen.getByTestId("ball-1-plus") as HTMLButtonElement;
    expect(plus.disabled).toBe(true);
    fireEvent.click(plus);
    expect(onSet).not.toHaveBeenCalled();
  });
});
