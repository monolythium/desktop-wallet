// MultisigAboutCard — rendering smoke test.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MultisigAboutCard } from "../MultisigAboutCard";

describe("MultisigAboutCard", () => {
  it("renders the headline and the §28.5 reference", () => {
    render(<MultisigAboutCard />);
    expect(screen.getByText(/About multisig/i)).toBeInTheDocument();
    expect(screen.getAllByText(/§28\.5/i).length).toBeGreaterThanOrEqual(1);
  });

  it("explains the chain-support gap", () => {
    render(<MultisigAboutCard />);
    expect(screen.getByText(/No multisig precompile yet/i)).toBeInTheDocument();
  });

  it("explains governance domain-tag protection", () => {
    render(<MultisigAboutCard />);
    expect(
      screen.getByText(/distinct cryptographic domain tag/i),
    ).toBeInTheDocument();
  });

  it("lists the four governance operations", () => {
    render(<MultisigAboutCard />);
    const node = screen.getByText(
      /Threshold change · add \/ remove \/ rotate signer/i,
    );
    expect(node).toBeInTheDocument();
  });
});
