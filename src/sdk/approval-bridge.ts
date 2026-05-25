// Approval-bridge bridge — handles the "approval-required" Tauri event
// stream from the Stele backend's loopback HTTP server, and resolves
// pending approvals via the stele_approval_resolve command.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { callStele, isTauri, SteleProxyCallError } from "./stele-base";

export { SteleProxyCallError as ApprovalCallError };

export interface ApprovalRequest {
  tool: string;
  summary: string;
  prepared_tx: unknown;
  wallet?: string | null;
  source?: unknown;
  expires_at?: string | null;
}

export interface ApprovalEvent {
  request_id: string;
  request: ApprovalRequest;
}

export interface ApprovalResolveInput {
  request_id: string;
  approved: boolean;
  wallet_passphrase?: string | null;
  reason?: string | null;
}

const SURFACE = "Approval bridge";

/**
 * Subscribe to incoming approval requests from lyth_mcp. Returns an
 * `unlisten` function the caller invokes when unmounting. Resolves to
 * `null` in browser preview where the Tauri event bus isn't available.
 */
export async function listenApprovals(
  handler: (event: ApprovalEvent) => void,
): Promise<UnlistenFn | null> {
  if (!isTauri()) return null;
  return await listen<ApprovalEvent>("approval-required", (e) => handler(e.payload));
}

export async function resolveApproval(input: ApprovalResolveInput): Promise<void> {
  await callStele<void>("stele_approval_resolve", { input }, SURFACE);
}
