// Small Stele-side wrappers that don't warrant their own file:
// natural-language search assistant, attestation list, MCP inbound probe.

import { callStele, SteleProxyCallError } from "./stele-base";

export { SteleProxyCallError as SteleExtrasCallError };

export interface Attestation {
  id: string;
  kind: string;
  issuer: string;
  issued_iso: string;
  expires_iso?: string | null;
  claims: unknown;
}

export interface McpInboundTestInput {
  url: string;
  auth_token: string;
}

export interface McpInboundTestOutput {
  ok: boolean;
  server_name?: string | null;
  tools: string[];
}

const SURFACE = "Stele";

export async function searchComplete(prompt: string): Promise<string> {
  return callStele<string>("stele_search_complete", { prompt }, SURFACE);
}

export async function attestationList(): Promise<Attestation[]> {
  return callStele<Attestation[]>("stele_attestation_list", undefined, SURFACE);
}

export async function mcpInboundTest(input: McpInboundTestInput): Promise<McpInboundTestOutput> {
  return callStele<McpInboundTestOutput>("stele_mcp_inbound_test", { input }, SURFACE);
}
