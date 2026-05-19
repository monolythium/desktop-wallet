// Global vitest setup — runs once per test file.
//
// `@testing-library/jest-dom/vitest` augments `expect()` with DOM
// matchers (`toBeInTheDocument`, `toHaveTextContent`, `toBeVisible`,
// etc.) so component tests can assert against rendered output
// without manually walking the DOM.
//
// Importing for side effects is sufficient — the package registers
// its matchers with vitest's global expect.

import "@testing-library/jest-dom/vitest";
