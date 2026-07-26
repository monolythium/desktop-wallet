// The shared password field.
//
// This is a presentation refactor of seven live password fields, two of which
// are fund-critical (the unlock gate and the operation drawer). The property
// that matters is that it changes nothing about the VALUE: whatever is typed
// reaches the caller byte-for-byte, because those bytes are what Argon2id
// derives from. A helpful trim here would fail a correct unlock.

import { describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { PasswordInput } from "../PasswordInput";

function setValue(input: HTMLElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the value passes through untouched", () => {
  it("reports exactly what was typed", () => {
    const onChange = vi.fn();
    const { container } = render(
      <PasswordInput value="" onChange={onChange} autoComplete="current-password" />,
    );
    setValue(container.querySelector("input")!, "x");
    expect(onChange).toHaveBeenCalledWith("x");
  });

  it("keeps a trailing space — part of the secret, not noise", () => {
    const onChange = vi.fn();
    const { container } = render(
      <PasswordInput value="" onChange={onChange} autoComplete="current-password" />,
    );
    setValue(container.querySelector("input")!, "my password ");
    expect(onChange).toHaveBeenCalledWith("my password ");
  });

  it("keeps leading whitespace and interior spacing", () => {
    const onChange = vi.fn();
    const { container } = render(
      <PasswordInput value="" onChange={onChange} autoComplete="new-password" />,
    );
    setValue(container.querySelector("input")!, "  two  spaces  ");
    expect(onChange).toHaveBeenCalledWith("  two  spaces  ");
  });

  it("imposes no maximum length", () => {
    const { container } = render(
      <PasswordInput value="" onChange={vi.fn()} autoComplete="new-password" />,
    );
    expect(container.querySelector("input")!.hasAttribute("maxLength")).toBe(false);
  });
});

describe("the reveal toggle", () => {
  it("starts hidden", () => {
    const { container } = render(
      <PasswordInput value="s3cret" onChange={vi.fn()} autoComplete="current-password" />,
    );
    expect(container.querySelector("input")!.getAttribute("type")).toBe("password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("flips the input type and the pressed state", () => {
    const { container } = render(
      <PasswordInput value="s3cret" onChange={vi.fn()} autoComplete="current-password" />,
    );
    act(() => {
      screen.getByRole("button", { name: "Show password" }).click();
    });
    expect(container.querySelector("input")!.getAttribute("type")).toBe("text");
    const toggle = screen.getByRole("button", { name: "Hide password" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      toggle.click();
    });
    expect(container.querySelector("input")!.getAttribute("type")).toBe("password");
  });

  it("does not submit the form or alter the value", () => {
    const onChange = vi.fn();
    render(
      <PasswordInput value="s3cret" onChange={onChange} autoComplete="current-password" />,
    );
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle.getAttribute("type")).toBe("button");
    act(() => {
      toggle.click();
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("host behaviour is preserved", () => {
  it("passes disabled through to BOTH the input and the toggle", () => {
    // On the operation drawer this prop is one of three lockout layers; a
    // toggle that stayed live would not bypass the lockout, but a disabled
    // field with a live control beside it reads as broken.
    const { container } = render(
      <PasswordInput
        value=""
        onChange={vi.fn()}
        autoComplete="current-password"
        disabled
      />,
    );
    expect(container.querySelector("input")!.hasAttribute("disabled")).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Show password" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("forwards the Enter key to the host's handler", () => {
    const onKeyDown = vi.fn();
    const { container } = render(
      <PasswordInput
        value="x"
        onChange={vi.fn()}
        autoComplete="current-password"
        onKeyDown={onKeyDown}
      />,
    );
    act(() => {
      container
        .querySelector("input")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
    });
    expect(onKeyDown).toHaveBeenCalled();
  });

  it("carries the password-manager hint each host chose", () => {
    const { container, rerender } = render(
      <PasswordInput value="" onChange={vi.fn()} autoComplete="new-password" />,
    );
    expect(container.querySelector("input")!.getAttribute("autocomplete")).toBe(
      "new-password",
    );
    rerender(
      <PasswordInput value="" onChange={vi.fn()} autoComplete="current-password" />,
    );
    expect(container.querySelector("input")!.getAttribute("autocomplete")).toBe(
      "current-password",
    );
  });

  it("honours autoFocus", () => {
    const { container } = render(
      <PasswordInput
        value=""
        onChange={vi.fn()}
        autoComplete="current-password"
        autoFocus
      />,
    );
    expect(document.activeElement).toBe(container.querySelector("input"));
  });

  it("keeps a host placeholder", () => {
    const { container } = render(
      <PasswordInput
        value=""
        onChange={vi.fn()}
        autoComplete="new-password"
        placeholder="At least 15 characters"
      />,
    );
    expect(container.querySelector("input")!.getAttribute("placeholder")).toBe(
      "At least 15 characters",
    );
  });
});
