// React hooks over the Phase 6 multisig + proposals SDK. Sibling to
// Phase 5's `useVaults` — same convention: every mutation refreshes
// the list on success, no global event bus.

import { useCallback, useEffect, useState } from "react";
import {
  MultisigInvokeError,
  multisigCreate,
  multisigSelect,
  multisigsList,
  proposalAttachSignature,
  proposalCancel,
  proposalCreate,
  proposalImportSignature,
  proposalMarkSubmitted,
  proposalsList,
  type MultisigVaultSummary,
  type Proposal,
  type ProposalOperationKind,
  type SignerInput,
} from "./multisig";

interface MultisigsState {
  status: "loading" | "ready" | "error";
  multisigs: MultisigVaultSummary[];
  error: MultisigInvokeError | null;
}

export interface UseMultisigsApi {
  state: MultisigsState;
  /** Currently-active multisig vault (if any). */
  active: MultisigVaultSummary | null;
  refresh: () => Promise<void>;
  create: (args: {
    label: string;
    signers: SignerInput[];
    threshold: number;
    password: string;
  }) => Promise<MultisigVaultSummary>;
  /** Switch the active vault to a multisig by id. */
  select: (multisigVaultId: string) => Promise<void>;
}

export function useMultisigs(): UseMultisigsApi {
  const [state, setState] = useState<MultisigsState>({
    status: "loading",
    multisigs: [],
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const list = await multisigsList();
      setState({ status: "ready", multisigs: list, error: null });
    } catch (cause) {
      const err =
        cause instanceof MultisigInvokeError
          ? cause
          : new MultisigInvokeError({
              layer: "backend",
              code: "backend",
              message: String(cause),
            });
      setState({ status: "error", multisigs: [], error: err });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (args: {
      label: string;
      signers: SignerInput[];
      threshold: number;
      password: string;
    }) => {
      const created = await multisigCreate(args);
      await refresh();
      return created;
    },
    [refresh],
  );

  const select = useCallback(
    async (multisigVaultId: string) => {
      await multisigSelect(multisigVaultId);
      await refresh();
    },
    [refresh],
  );

  const active = state.multisigs.find((m) => m.isActive) ?? null;

  return { state, active, refresh, create, select };
}

interface ProposalsState {
  status: "loading" | "ready" | "error";
  proposals: Proposal[];
  error: MultisigInvokeError | null;
}

export interface UseProposalsApi {
  state: ProposalsState;
  refresh: () => Promise<void>;
  create: (args: {
    operation: ProposalOperationKind;
    payload: Uint8Array;
    createdByAddress: string;
    ttlSecs?: number;
  }) => Promise<Proposal>;
  sign: (args: {
    proposalId: string;
    signerAddress: string;
    signature: Uint8Array;
  }) => Promise<Proposal>;
  importSignature: (args: {
    proposalId: string;
    signerAddress: string;
    signature: Uint8Array;
  }) => Promise<Proposal>;
  cancel: (proposalId: string, byAddress: string) => Promise<void>;
  markSubmitted: (proposalId: string, txHash: string) => Promise<Proposal>;
}

export function useProposals(multisigVaultId: string | null | undefined): UseProposalsApi {
  const [state, setState] = useState<ProposalsState>({
    status: "loading",
    proposals: [],
    error: null,
  });

  const refresh = useCallback(async () => {
    if (!multisigVaultId) {
      setState({ status: "ready", proposals: [], error: null });
      return;
    }
    try {
      const list = await proposalsList(multisigVaultId);
      setState({ status: "ready", proposals: list, error: null });
    } catch (cause) {
      const err =
        cause instanceof MultisigInvokeError
          ? cause
          : new MultisigInvokeError({
              layer: "backend",
              code: "backend",
              message: String(cause),
            });
      setState({ status: "error", proposals: [], error: err });
    }
  }, [multisigVaultId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (args: {
      operation: ProposalOperationKind;
      payload: Uint8Array;
      createdByAddress: string;
      ttlSecs?: number;
    }) => {
      if (!multisigVaultId) {
        throw new MultisigInvokeError({
          layer: "multisig",
          code: "not_found",
          message: "no active multisig vault",
        });
      }
      const created = await proposalCreate({
        multisigVaultId,
        operation: args.operation,
        payload: args.payload,
        createdByAddress: args.createdByAddress,
        ttlSecs: args.ttlSecs,
      });
      await refresh();
      return created;
    },
    [multisigVaultId, refresh],
  );

  const sign = useCallback(
    async (args: {
      proposalId: string;
      signerAddress: string;
      signature: Uint8Array;
    }) => {
      const updated = await proposalAttachSignature(args);
      await refresh();
      return updated;
    },
    [refresh],
  );

  const importSignature = useCallback(
    async (args: {
      proposalId: string;
      signerAddress: string;
      signature: Uint8Array;
    }) => {
      const updated = await proposalImportSignature(args);
      await refresh();
      return updated;
    },
    [refresh],
  );

  const cancel = useCallback(
    async (proposalId: string, byAddress: string) => {
      await proposalCancel({ proposalId, byAddress });
      await refresh();
    },
    [refresh],
  );

  const markSubmitted = useCallback(
    async (proposalId: string, txHash: string) => {
      const updated = await proposalMarkSubmitted({ proposalId, txHash });
      await refresh();
      return updated;
    },
    [refresh],
  );

  return { state, refresh, create, sign, importSignature, cancel, markSubmitted };
}
