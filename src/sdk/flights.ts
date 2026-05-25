// Flight bridge — proxies through the Stele sidecar into lyth_mcp's
// Duffel-backed flight_* tools. Holds are 24h; final payment goes
// through NowPayments via stele_booking_invoice_create.

import { callStele, SteleProxyCallError } from "./stele-base";

export { SteleProxyCallError as FlightCallError };

export interface FlightSearchInput {
  origin: string;
  destination: string;
  departure_date: string;
  return_date?: string | null;
  passengers?: number | null;
  cabin?: "economy" | "premium-economy" | "business" | "first" | null;
}

export interface FlightOrderInput {
  offer_id: string;
  passenger_profiles?: string[] | null;
  passengers?: unknown;
}

const SURFACE = "Flights";

export async function flightSearch(input: FlightSearchInput): Promise<unknown> {
  return callStele<unknown>("stele_flight_search", { input }, SURFACE);
}

export async function flightOfferGet(offerId: string): Promise<unknown> {
  return callStele<unknown>("stele_flight_offer_get", { offerId }, SURFACE);
}

export async function flightOrderHold(input: FlightOrderInput): Promise<unknown> {
  return callStele<unknown>("stele_flight_order_hold", { input }, SURFACE);
}

export async function flightOrderList(): Promise<unknown> {
  return callStele<unknown>("stele_flight_order_list", undefined, SURFACE);
}
