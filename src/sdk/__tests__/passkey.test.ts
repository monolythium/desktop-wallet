// Phase 8 passkey TS bindings — error mapping + wire-shape mapping +
// every command's invoke surface + hooks.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  _assertionFromWireForTest,
  _challengeFromWireForTest,
  _passkeySummaryFromWireForTest,
  attestPasskey,
  createPasskeyChallenge,
  enrollPasskey,
  listPasskeys,
  PasskeyCallError,
  removePasskey,
  renamePasskey,
  useChallenge,
  usePasskeys,
} from "../passkey";

beforeEach(() => {
  invokeMock.mockReset();
});

// ─── Wire-shape mapping ──────────────────────────────────────────────

describe("passkey · summary wire mapping", () => {
  it("maps snake_case fields into camelCase", () => {
    const out = _passkeySummaryFromWireForTest({
      id: "abc",
      backend: "software",
      public_key: "pub",
      label: "Test",
      device_name: "host-1",
      counter: 3,
      created_at: 100,
      last_used: 200,
    });
    expect(out).toEqual({
      id: "abc",
      backend: "software",
      publicKey: "pub",
      label: "Test",
      deviceName: "host-1",
      counter: 3,
      createdAt: 100,
      lastUsed: 200,
    });
  });

  it("passes through null device_name", () => {
    const out = _passkeySummaryFromWireForTest({
      id: "x",
      backend: "software",
      public_key: "p",
      label: "L",
      device_name: null,
      counter: 0,
      created_at: 0,
      last_used: 0,
    });
    expect(out.deviceName).toBeNull();
  });
});

describe("passkey · challenge wire mapping", () => {
  it("maps snake_case to camelCase", () => {
    const out = _challengeFromWireForTest({
      nonce: "n",
      payload_hash: "p",
      created_at: 100,
      expires_at: 160,
    });
    expect(out).toEqual({
      nonce: "n",
      payloadHash: "p",
      createdAt: 100,
      expiresAt: 160,
    });
  });
});

describe("passkey · assertion wire mapping", () => {
  it("maps the full payload including the nested challenge", () => {
    const out = _assertionFromWireForTest({
      credential_id: "cid",
      signature: "sig",
      challenge: {
        nonce: "n",
        payload_hash: "p",
        created_at: 1,
        expires_at: 61,
      },
      new_counter: 4,
    });
    expect(out).toEqual({
      credentialId: "cid",
      signature: "sig",
      challenge: {
        nonce: "n",
        payloadHash: "p",
        createdAt: 1,
        expiresAt: 61,
      },
      newCounter: 4,
    });
  });
});

// ─── Command wrappers ───────────────────────────────────────────────

describe("passkey · listPasskeys", () => {
  it("invokes passkey_list with vaultId and maps the response", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "1",
        backend: "software",
        public_key: "p",
        label: "L",
        device_name: null,
        counter: 0,
        created_at: 0,
        last_used: 0,
      },
    ]);
    const out = await listPasskeys("v1");
    expect(invokeMock).toHaveBeenCalledWith("passkey_list", { vaultId: "v1" });
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("1");
  });

  it("wraps vault_locked errors as PasskeyCallError", async () => {
    invokeMock.mockRejectedValueOnce({ code: "vault_locked" });
    try {
      await listPasskeys("v1");
      expect.unreachable();
    } catch (cause) {
      const err = cause as PasskeyCallError;
      expect(err).toBeInstanceOf(PasskeyCallError);
      expect(err.cause.code).toBe("vault_locked");
    }
  });
});

describe("passkey · enrollPasskey", () => {
  it("invokes passkey_enroll with label and deviceName", async () => {
    invokeMock.mockResolvedValueOnce({
      id: "1",
      backend: "software",
      public_key: "p",
      label: "Test",
      device_name: "host",
      counter: 0,
      created_at: 0,
      last_used: 0,
    });
    const out = await enrollPasskey({
      vaultId: "v1",
      label: "Test",
      deviceName: "host",
    });
    expect(invokeMock).toHaveBeenCalledWith("passkey_enroll", {
      vaultId: "v1",
      label: "Test",
      deviceName: "host",
    });
    expect(out.label).toBe("Test");
  });

  it("rejects empty labels client-side before reaching invoke", async () => {
    try {
      await enrollPasskey({ vaultId: "v1", label: "   " });
      expect.unreachable();
    } catch (cause) {
      const err = cause as PasskeyCallError;
      expect(err.cause.code).toBe("invalid_label");
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("surfaces limit_reached errors typed", async () => {
    invokeMock.mockRejectedValueOnce({ code: "limit_reached", max: 8 });
    try {
      await enrollPasskey({ vaultId: "v1", label: "Test" });
      expect.unreachable();
    } catch (cause) {
      const err = cause as PasskeyCallError;
      expect(err.cause.code).toBe("limit_reached");
      expect((err.cause as { max: number }).max).toBe(8);
    }
  });
});

describe("passkey · renamePasskey", () => {
  it("invokes passkey_rename with the new label", async () => {
    invokeMock.mockResolvedValueOnce({
      id: "c1",
      backend: "software",
      public_key: "p",
      label: "New",
      device_name: null,
      counter: 0,
      created_at: 0,
      last_used: 0,
    });
    const out = await renamePasskey({
      vaultId: "v1",
      credentialId: "c1",
      newLabel: "New",
    });
    expect(invokeMock).toHaveBeenCalledWith("passkey_rename", {
      vaultId: "v1",
      credentialId: "c1",
      newLabel: "New",
    });
    expect(out.label).toBe("New");
  });
});

describe("passkey · removePasskey", () => {
  it("invokes passkey_remove with the password gate", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await removePasskey({
      vaultId: "v1",
      credentialId: "c1",
      password: "pw",
    });
    expect(invokeMock).toHaveBeenCalledWith("passkey_remove", {
      vaultId: "v1",
      credentialId: "c1",
      password: "pw",
    });
  });

  it("surfaces wrong_password errors typed", async () => {
    invokeMock.mockRejectedValueOnce({ code: "wrong_password" });
    try {
      await removePasskey({ vaultId: "v1", credentialId: "c1", password: "bad" });
      expect.unreachable();
    } catch (cause) {
      expect((cause as PasskeyCallError).cause.code).toBe("wrong_password");
    }
  });
});

describe("passkey · createPasskeyChallenge", () => {
  it("invokes passkey_challenge_create and maps the response", async () => {
    invokeMock.mockResolvedValueOnce({
      nonce: "n",
      payload_hash: "p",
      created_at: 100,
      expires_at: 160,
    });
    const out = await createPasskeyChallenge("p");
    expect(invokeMock).toHaveBeenCalledWith("passkey_challenge_create", {
      payloadHashB64: "p",
    });
    expect(out.expiresAt).toBe(160);
  });

  it("surfaces malformed errors typed", async () => {
    invokeMock.mockRejectedValueOnce({ code: "malformed" });
    try {
      await createPasskeyChallenge("not-base64-32-bytes");
      expect.unreachable();
    } catch (cause) {
      expect((cause as PasskeyCallError).cause.code).toBe("malformed");
    }
  });
});

describe("passkey · attestPasskey", () => {
  it("invokes passkey_attest with the camelCase→snake_case challenge", async () => {
    invokeMock.mockResolvedValueOnce({
      credential_id: "c1",
      signature: "s",
      challenge: {
        nonce: "n",
        payload_hash: "p",
        created_at: 100,
        expires_at: 160,
      },
      new_counter: 1,
    });
    const out = await attestPasskey({
      vaultId: "v1",
      credentialId: "c1",
      challenge: {
        nonce: "n",
        payloadHash: "p",
        createdAt: 100,
        expiresAt: 160,
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("passkey_attest", {
      vaultId: "v1",
      credentialId: "c1",
      challenge: {
        nonce: "n",
        payload_hash: "p",
        created_at: 100,
        expires_at: 160,
      },
    });
    expect(out.newCounter).toBe(1);
  });

  it("surfaces counter_regression errors typed", async () => {
    invokeMock.mockRejectedValueOnce({ code: "counter_regression" });
    try {
      await attestPasskey({
        vaultId: "v1",
        credentialId: "c1",
        challenge: {
          nonce: "n",
          payloadHash: "p",
          createdAt: 0,
          expiresAt: 60,
        },
      });
      expect.unreachable();
    } catch (cause) {
      expect((cause as PasskeyCallError).cause.code).toBe("counter_regression");
    }
  });
});

// ─── Hooks ──────────────────────────────────────────────────────────

describe("usePasskeys hook", () => {
  it("loads passkeys for the given vault and exposes them on the api", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "c1",
        backend: "software",
        public_key: "p",
        label: "First",
        device_name: null,
        counter: 0,
        created_at: 100,
        last_used: 100,
      },
    ]);
    const { result } = renderHook(() => usePasskeys("v1"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.passkeys).toHaveLength(1);
    expect(result.current.passkeys[0]?.label).toBe("First");
  });

  it("returns empty + idle when vaultId is null", async () => {
    const { result } = renderHook(() => usePasskeys(null));
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.passkeys).toEqual([]);
  });

  it("surfaces backend errors via the api", async () => {
    invokeMock.mockRejectedValueOnce({ code: "vault_locked" });
    const { result } = renderHook(() => usePasskeys("v1"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.cause.code).toBe("vault_locked");
  });

  it("refreshes after enroll", async () => {
    invokeMock.mockResolvedValueOnce([]); // initial list
    const { result } = renderHook(() => usePasskeys("v1"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.passkeys).toHaveLength(0);

    // enroll → new entry → refresh returns it
    invokeMock.mockResolvedValueOnce({
      id: "c1",
      backend: "software",
      public_key: "p",
      label: "New",
      device_name: null,
      counter: 0,
      created_at: 0,
      last_used: 0,
    });
    invokeMock.mockResolvedValueOnce([
      {
        id: "c1",
        backend: "software",
        public_key: "p",
        label: "New",
        device_name: null,
        counter: 0,
        created_at: 0,
        last_used: 0,
      },
    ]);
    await act(async () => {
      await result.current.enroll({ label: "New" });
    });
    expect(result.current.passkeys).toHaveLength(1);
  });
});

describe("useChallenge hook", () => {
  it("combines challenge_create + attest into a single call", async () => {
    invokeMock.mockResolvedValueOnce({
      nonce: "n",
      payload_hash: "ph",
      created_at: 100,
      expires_at: 160,
    });
    invokeMock.mockResolvedValueOnce({
      credential_id: "c1",
      signature: "s",
      challenge: {
        nonce: "n",
        payload_hash: "ph",
        created_at: 100,
        expires_at: 160,
      },
      new_counter: 1,
    });
    const { result } = renderHook(() => useChallenge());
    const assertion = await result.current.triggerHighValueChallenge({
      payloadHashB64: "ph",
      vaultId: "v1",
      credentialId: "c1",
    });
    expect(assertion.newCounter).toBe(1);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "passkey_challenge_create", {
      payloadHashB64: "ph",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "passkey_attest",
      expect.objectContaining({ vaultId: "v1", credentialId: "c1" }),
    );
  });
});
