// The error boundary catches a render throw and shows the recovery UI instead of
// white-screening — and never renders the error's (potentially sensitive)
// contents. resetKey change / retry recover it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "../ErrorBoundary";

function Boom({ secret }: { secret: string }): never {
  throw new Error(`sensitive-vault-detail: ${secret}`);
}

afterEach(() => cleanup());

describe("ErrorBoundary", () => {
  it("renders the recovery fallback instead of crashing, and leaks no error content", () => {
    // React logs the caught error to console.error itself — silence it for the test.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={() => <div>recovery ui</div>}>
        <Boom secret="0xdeadbeef-seed" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("recovery ui")).toBeInTheDocument();
    // The thrown message (which stands in for sensitive data) is never shown.
    expect(document.body.textContent).not.toContain("0xdeadbeef-seed");
    expect(document.body.textContent).not.toContain("sensitive-vault-detail");
    spy.mockRestore();
  });

  it("renders children normally when nothing throws", () => {
    render(
      <ErrorBoundary fallback={() => <div>fallback</div>}>
        <div>child ok</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("child ok")).toBeInTheDocument();
    expect(screen.queryByText("fallback")).toBeNull();
  });

  it("clears the error when resetKey changes, so navigating away recovers", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary resetKey="page-a" fallback={() => <div>fallback</div>}>
        <Boom secret="x" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("fallback")).toBeInTheDocument();
    rerender(
      <ErrorBoundary resetKey="page-b" fallback={() => <div>fallback</div>}>
        <div>recovered child</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("recovered child")).toBeInTheDocument();
    spy.mockRestore();
  });
});
