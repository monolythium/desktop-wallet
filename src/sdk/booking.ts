// Booking bridge — proxies through the Stele backend's lyth_mcp sidecar.
// State machine on the chain side:
//   Open → Negotiating(round_n) → Accepted → InProgress → Submitted →
//          Released | Disputed
//
// Today: request + accept + release + dispute are all live proxies into
// lyth_mcp. `bookingCounter` returns `not_implemented` because lyth_mcp
// needs to add a `booking_counter_offer` tool first
// (stele-desktop docs/lyth-mcp-gaps.md §4).

import { callStele, SteleProxyCallError } from "./stele-base";

export { SteleProxyCallError as BookingCallError };

export interface BookingRequestInput {
  provider_id: string;
  service_id: string;
  date_iso: string;
  description: string;
  proposed_price_lyth: string;
  arbiter_id: string;
}

export interface BookingCounterInput {
  booking_id: string;
  price_lyth?: string | null;
  date_iso?: string | null;
  note?: string | null;
}

const SURFACE = "Bookings";

export async function bookingRequest(input: BookingRequestInput): Promise<unknown> {
  return callStele<unknown>("stele_booking_request", { input }, SURFACE);
}

export async function bookingCounter(input: BookingCounterInput): Promise<unknown> {
  return callStele<unknown>("stele_booking_counter", { input }, SURFACE);
}

export async function bookingAccept(bookingId: string): Promise<unknown> {
  return callStele<unknown>("stele_booking_accept", { bookingId }, SURFACE);
}

export async function bookingRelease(bookingId: string, txHash: string): Promise<unknown> {
  return callStele<unknown>("stele_booking_release", { bookingId, txHash }, SURFACE);
}

export async function bookingDispute(bookingId: string, evidence: string): Promise<unknown> {
  return callStele<unknown>("stele_booking_dispute", { bookingId, evidence }, SURFACE);
}
