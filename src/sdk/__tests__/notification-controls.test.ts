import { beforeEach, describe, expect, it } from "vitest";
import { notificationToast, type NotificationRecord } from "../notifications";
import {
  readNotificationDetails,
  readNotificationsEnabled,
  readNotifyWhileLocked,
  writeNotificationDetails,
  writeNotificationsEnabled,
  writeNotifyWhileLocked,
} from "../feature-flags";

const rec: NotificationRecord = {
  id: "0x10f2c:0xabc",
  txHash: "0xabc",
  status: "confirmed",
  blockNumber: 1,
  kind: "send",
  amountDecimal: "12.5",
  counterparty: "mono1abcdefghijklmnopqrstuvwxyz",
  createdAtMs: 1,
  read: false,
  schemaVersion: 0,
};

describe("notificationToast detail redaction", () => {
  it("includes the amount and address by default", () => {
    const { title, body } = notificationToast(rec);
    expect(title).toBe("Sent");
    expect(body).toContain("12.5 LYTH");
    expect(body).toContain("mono1");
  });

  it("redacts the body to the title only when details are off", () => {
    const { title, body } = notificationToast(rec, false);
    expect(title).toBe("Sent");
    expect(body).toBe("");
  });

  it("omits the amount for a zero-amount record (details on)", () => {
    const { body } = notificationToast({ ...rec, amountDecimal: "0" });
    expect(body).not.toContain("LYTH");
    expect(body).toContain("mono1");
  });
});

describe("notification control flags", () => {
  beforeEach(() => localStorage.clear());

  it("default to ON when unset (fail-open)", () => {
    expect(readNotificationsEnabled()).toBe(true);
    expect(readNotificationDetails()).toBe(true);
    expect(readNotifyWhileLocked()).toBe(true);
  });

  it("round-trip each flag false then true", () => {
    writeNotificationsEnabled(false);
    expect(readNotificationsEnabled()).toBe(false);
    writeNotificationsEnabled(true);
    expect(readNotificationsEnabled()).toBe(true);

    writeNotificationDetails(false);
    expect(readNotificationDetails()).toBe(false);

    writeNotifyWhileLocked(false);
    expect(readNotifyWhileLocked()).toBe(false);
  });
});
