// Vitest global setup for the component-render harness.
//
// Adds jest-dom's DOM matchers (`toBeInTheDocument`, `toBeDisabled`, …) to
// `expect`, and unmounts anything a render test mounted after each test so the
// shared jsdom document doesn't leak nodes between cases. Pure-logic tests are
// unaffected — they simply never render.

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
