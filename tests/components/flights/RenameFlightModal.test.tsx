// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import RenameFlightModal from "@/components/flights/RenameFlightModal";

afterEach(() => cleanup());

describe("RenameFlightModal", () => {
  it("prefills the current name and saves a trimmed value", () => {
    const onSave = vi.fn();
    render(<RenameFlightModal currentName="Flight B" onSave={onSave} onCancel={vi.fn()} />);
    const input = screen.getByLabelText("Flight name") as HTMLInputElement;
    expect(input.value).toBe("Flight B");
    fireEvent.change(input, { target: { value: "  4-Man  " } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith("4-Man");
  });

  it("disables Save for a blank name (negative control)", () => {
    const onSave = vi.fn();
    render(<RenameFlightModal currentName="Flight B" onSave={onSave} onCancel={vi.fn()} />);
    const input = screen.getByLabelText("Flight name");
    fireEvent.change(input, { target: { value: "   " } });
    const save = screen.getByText("Save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Enter submits a valid name; Cancel fires onCancel", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<RenameFlightModal currentName="Flight B" onSave={onSave} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByLabelText("Flight name"), { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("Flight B");
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });
});
