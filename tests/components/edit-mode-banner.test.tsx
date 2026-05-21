// @vitest-environment jsdom
//
// Tests for the EditModeBanner component — banner visibility gating on
// ?admin=1&edit=1 and the Done button dropping ?edit=1 from the URL.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const searchParamsRef = { current: new URLSearchParams("") };
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
  usePathname: () => "/round/1/summary",
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

import EditModeBanner from "@/components/round/EditModeBanner";

describe("EditModeBanner", () => {
  beforeEach(() => {
    cleanup();
    replaceMock.mockClear();
  });

  it("renders when ?admin=1 and ?edit=1 are both set", () => {
    searchParamsRef.current = new URLSearchParams("admin=1&edit=1");
    render(<EditModeBanner />);
    expect(screen.getByTestId("edit-mode-banner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
  });

  it("does not render when only ?admin=1 is set", () => {
    searchParamsRef.current = new URLSearchParams("admin=1");
    render(<EditModeBanner />);
    expect(screen.queryByTestId("edit-mode-banner")).toBeNull();
  });

  it("does not render when ?edit=1 is set but ?admin=1 is not", () => {
    searchParamsRef.current = new URLSearchParams("edit=1");
    render(<EditModeBanner />);
    expect(screen.queryByTestId("edit-mode-banner")).toBeNull();
  });

  it("Done button calls router.replace dropping ?edit=1 only", () => {
    searchParamsRef.current = new URLSearchParams("admin=1&edit=1&team=2");
    render(<EditModeBanner />);
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(replaceMock).toHaveBeenCalledTimes(1);
    const href = replaceMock.mock.calls[0][0] as string;
    expect(href.startsWith("/round/1/summary")).toBe(true);
    const next = new URLSearchParams(href.split("?")[1] ?? "");
    expect(next.has("edit")).toBe(false);
    expect(next.get("admin")).toBe("1");
    expect(next.get("team")).toBe("2");
  });
});
