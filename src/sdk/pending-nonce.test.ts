import { beforeEach, describe, expect, it } from "vitest";
import {
  nextSendNonce,
  recordSubmittedNonce,
  _resetPendingNonces,
} from "./pending-nonce";

const A = "0xAbC0000000000000000000000000000000000001";
const CHAIN = "0x10f2c"; // the active-chain key from scopeChainKey()
const CHAIN_OTHER = "0x539"; // a second (custom) chain

describe("pending-nonce tracker", () => {
  beforeEach(() => _resetPendingNonces());

  it("returns the committed nonce unchanged when nothing is pending", () => {
    expect(nextSendNonce(A, CHAIN, 5n)).toBe(5n);
  });

  it("advances past a just-submitted nonce (2nd send before the 1st commits)", () => {
    expect(nextSendNonce(A, CHAIN, 5n)).toBe(5n);
    recordSubmittedNonce(A, CHAIN, 5n); // 1st send succeeded at nonce 5
    // committed is still 5 (1st not yet committed) → next must be 6, not 5.
    expect(nextSendNonce(A, CHAIN, 5n)).toBe(6n);
  });

  it("uses the committed nonce once the chain advances past the pending one", () => {
    recordSubmittedNonce(A, CHAIN, 5n);
    // 1st committed → chain now reports 6 (or higher); never go backwards.
    expect(nextSendNonce(A, CHAIN, 6n)).toBe(6n);
    expect(nextSendNonce(A, CHAIN, 9n)).toBe(9n);
  });

  it("is keyed per (address, chain)", () => {
    recordSubmittedNonce(A, CHAIN, 5n);
    expect(nextSendNonce(A, CHAIN, 5n)).toBe(6n);
    expect(nextSendNonce("0xdeadbeef00000000000000000000000000000002", CHAIN, 5n)).toBe(5n);
    // A different chain is a different entry — a nonce submitted on one chain
    // must never advance the nonce the wallet signs on another.
    expect(nextSendNonce(A, CHAIN_OTHER, 5n)).toBe(5n);
  });

  it("is address-case-insensitive", () => {
    recordSubmittedNonce(A.toLowerCase(), CHAIN, 7n);
    expect(nextSendNonce(A.toUpperCase(), CHAIN, 7n)).toBe(8n);
  });
});
