// Outbound MCP server — exposes Stele's surface to external automation clients
// (desktop MCP clients) over a per-session loopback
// HTTP endpoint. User toggles this from Settings → Stele → MCP.

import { callStele, SteleProxyCallError } from "./stele-base";

export { SteleProxyCallError as OutboundMcpCallError };

export interface McpOutboundStatus {
  enabled: boolean;
  url: string | null;
  auth_token: string | null;
  scopes: string[];
}

const SURFACE = "Outbound MCP";

export async function outboundMcpStatus(): Promise<McpOutboundStatus> {
  return callStele<McpOutboundStatus>("stele_outbound_mcp_status", undefined, SURFACE);
}

export async function outboundMcpStart(): Promise<McpOutboundStatus> {
  return callStele<McpOutboundStatus>("stele_outbound_mcp_start", undefined, SURFACE);
}

export async function outboundMcpStop(): Promise<McpOutboundStatus> {
  return callStele<McpOutboundStatus>("stele_outbound_mcp_stop", undefined, SURFACE);
}
