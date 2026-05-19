// Global vitest setup — runs once per test file.
//
// `@testing-library/jest-dom/vitest` augments `expect()` with DOM
// matchers (`toBeInTheDocument`, `toHaveTextContent`, `toBeVisible`,
// etc.) so component tests can assert against rendered output
// without manually walking the DOM.
//
// Importing for side effects is sufficient — the package registers
// its matchers with vitest's global expect.
//
// `cleanup()` after each test unmounts every component rendered via
// @testing-library/react. Without this, consecutive tests in the
// same file share the jsdom body and `getByText` ambiguities surface
// as multiple-match errors. testing-library v16 doesn't auto-register
// the afterEach hook when `globals: false`; doing it once here keeps
// every test file isolated.

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});
