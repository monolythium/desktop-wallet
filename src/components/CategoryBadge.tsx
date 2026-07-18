// Category pill for a hierarchical registry name.
//
// Renders NOTHING for anything outside the known five. A guessed or defaulted
// category would be a fabricated claim about an identity, which is exactly the
// kind of small invention this wallet does not ship — an absent badge is the
// honest outcome.

import { parseNameCategory } from "@monolythium/core-sdk";

/** The registry taxonomy, in full. */
export const NAME_CATEGORIES = ["human", "agent", "cluster", "contract", "system"] as const;
export type NameCategory = (typeof NAME_CATEGORIES)[number];

export function isNameCategory(value: unknown): value is NameCategory {
  return typeof value === "string" && (NAME_CATEGORIES as readonly string[]).includes(value);
}

/** Structural category of a name, or null when it does not parse. The quorum
 *  admits only parseable names, so null here is belt-and-suspenders. */
export function categoryOfName(name: string | null | undefined): NameCategory | null {
  if (typeof name !== "string" || name.trim() === "") return null;
  try {
    const parsed = parseNameCategory(name.trim()) as { category?: unknown };
    return isNameCategory(parsed.category) ? parsed.category : null;
  } catch {
    return null;
  }
}

export function CategoryBadge({ category }: { category: string | null | undefined }) {
  if (!isNameCategory(category)) return null;
  return (
    <span
      data-testid="category-badge"
      style={{
        // Colour comes from design tokens only — never a literal.
        background: `var(--cat-${category}-bg)`,
        color: `var(--cat-${category}-fg)`,
        fontSize: 9,
        fontWeight: 600,
        textTransform: "uppercase",
        borderRadius: 4,
        padding: "1px 5px",
        marginLeft: 6,
        letterSpacing: "0.08em",
      }}
    >
      {category}
    </span>
  );
}
