// Spend bridge — Coinsbee gift cards via NowPayments invoice. The user
// pays in crypto; NowPayments confirms; the user then completes the
// gift-card redemption on Coinsbee with the receipt id.
//
// Also: stele_booking_invoice_create for the matching booking-pay flow.

import { callStele, SteleProxyCallError } from "./stele-base";

export { SteleProxyCallError as SpendCallError };

export interface CoinsbeeGuideInput {
  category?: string | null;
}

export interface SpendCoinsbeeInvoiceInput {
  usd_amount: number;
  pay_currency: string;
  description?: string | null;
}

export interface BookingInvoiceInput {
  booking_id: string;
  price_usd: number;
  pay_currency: string;
}

const SURFACE = "Spend";

export async function spendCoinsbeeGuide(input: CoinsbeeGuideInput): Promise<unknown> {
  return callStele<unknown>("stele_spend_coinsbee_guide", { input }, SURFACE);
}

export async function spendCoinsbeeInvoice(input: SpendCoinsbeeInvoiceInput): Promise<unknown> {
  return callStele<unknown>("stele_spend_coinsbee_invoice", { input }, SURFACE);
}

export async function bookingInvoiceCreate(input: BookingInvoiceInput): Promise<unknown> {
  return callStele<unknown>("stele_booking_invoice_create", { input }, SURFACE);
}
