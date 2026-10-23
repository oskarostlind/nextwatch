// scripts/stats-selftest.ts — enhetstest för de rena hjälparna bakom /api/stats.
// Repot saknar testrunner; kör med: npx tsx scripts/stats-selftest.ts
// Rör ingen databas och inga externa API:er.
import assert from "node:assert/strict";
import {
  SERIES_DAYS,
  addDays,
  buildSeries,
  emptySeries,
  seriesDays,
  startOfStockholmDay,
  stockholmDay,
} from "../lib/stats/contract";
import { aggregateBalanceTransactions, computeMrr } from "../lib/stats/revenue-stripe";
import { admobToMinor, buildRevenueBlock } from "../lib/stats/collect";

let n = 0;
function test(name: string, fn: () => void) {
  fn();
  n += 1;
  console.log(`ok - ${name}`);
}

test("stockholmDay följer svensk kalenderdag", () => {
  // 23:30 UTC 31 dec = 00:30 1 jan i Stockholm (vintertid +1)
  assert.equal(stockholmDay(new Date("2025-12-31T23:30:00Z")), "2026-01-01");
  // 21:59 UTC 30 jun = 23:59 30 jun (sommartid +2), 22:00 UTC = 00:00 1 jul
  assert.equal(stockholmDay(new Date("2026-06-30T21:59:00Z")), "2026-06-30");
  assert.equal(stockholmDay(new Date("2026-06-30T22:00:00Z")), "2026-07-01");
});

test("startOfStockholmDay ger lokal midnatt i UTC, även vid sommartidsbyten", () => {
  assert.equal(startOfStockholmDay("2026-01-15").toISOString(), "2026-01-14T23:00:00.000Z");
  assert.equal(startOfStockholmDay("2026-07-15").toISOString(), "2026-07-14T22:00:00.000Z");
  // Sommartid börjar 29 mars 2026 (02→03), slutar 25 okt 2026 (03→02)
  assert.equal(startOfStockholmDay("2026-03-29").toISOString(), "2026-03-28T23:00:00.000Z");
  assert.equal(startOfStockholmDay("2026-03-30").toISOString(), "2026-03-29T22:00:00.000Z");
  assert.equal(startOfStockholmDay("2026-10-25").toISOString(), "2026-10-24T22:00:00.000Z");
  assert.equal(startOfStockholmDay("2026-10-26").toISOString(), "2026-10-25T23:00:00.000Z");
});

test("seriesDays/emptySeries: exakt 31 stigande dagar som slutar idag (Stockholm)", () => {
  const now = new Date("2026-10-25T22:30:00Z"); // 23:30 25 okt lokalt, dagen efter sommartidens slut
  const days = seriesDays(now);
  assert.equal(days.length, SERIES_DAYS);
  assert.equal(days[30], "2026-10-25");
  assert.equal(days[0], "2026-09-25");
  for (let i = 1; i < days.length; i++) assert.equal(days[i], addDays(days[i - 1], 1));
  const e = emptySeries(now);
  assert.equal(e.length, 31);
  assert.ok(e.every((p) => p.value === 0));
  // Över månads- och årsskifte
  assert.equal(seriesDays(new Date("2026-01-01T10:00:00Z"))[0], "2025-12-02");
});

test("buildSeries nollfyller och ignorerar dagar utanför fönstret", () => {
  const days = seriesDays(new Date("2026-10-23T12:00:00Z"));
  const s = buildSeries("users_new", "Nya", days, [
    { day: "2026-10-23", value: 4 },
    { day: "2026-09-23", value: 2 },
    { day: "2026-09-22", value: 99 }, // utanför
  ]);
  assert.equal(s.points.length, 31);
  assert.equal(s.points[30].value, 4);
  assert.equal(s.points[0].value, 2);
  assert.equal(s.points.reduce((a, p) => a + p.value, 0), 6);
  assert.equal(s.unit, undefined);
});

test("aggregateBalanceTransactions: brutto/netto per Stockholm-dag, ignorerar utbetalningar", () => {
  const t = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  const { perDay, warnings } = aggregateBalanceTransactions([
    { type: "charge", amount: 7900, net: 7400, created: t("2026-10-22T22:30:00Z"), currency: "sek" }, // 00:30 23 okt
    { type: "payment", amount: 59900, net: 57000, created: t("2026-10-23T08:00:00Z"), currency: "sek" },
    { type: "refund", amount: -7900, net: -7900, created: t("2026-10-23T09:00:00Z"), currency: "sek" },
    { type: "payout", amount: -100000, net: -100000, created: t("2026-10-23T09:00:00Z"), currency: "sek" },
    { type: "stripe_fee", amount: -500, net: -500, created: t("2026-10-23T09:00:00Z"), currency: "sek" },
    { type: "charge", amount: 1000, net: 900, created: t("2026-10-21T12:00:00Z"), currency: "eur" },
    { type: "charge", amount: 1000, net: 900, created: t("2026-10-21T12:00:00Z"), currency: "usd" },
  ], (cur) => (cur === "eur" ? 11.5 : null));
  assert.deepEqual(perDay.get("2026-10-23"), { gross: 7900 + 59900 - 7900, net: 7400 + 57000 - 7900 });
  assert.deepEqual(perDay.get("2026-10-21"), { gross: 11500, net: 10350 });
  assert.equal(perDay.has("2026-10-22"), false);
  assert.ok(warnings.some((w) => w.includes("usd")));
  assert.ok(warnings.some((w) => w.includes("eur")));
});

test("computeMrr normaliserar till månad; trialing räknas men utan belopp", () => {
  const r = computeMrr([
    { status: "active", items: [{ unitAmount: 7900, quantity: 1, currency: "sek", interval: "month", intervalCount: 1 }] },
    { status: "active", items: [{ unitAmount: 59900, quantity: 1, currency: "sek", interval: "year", intervalCount: 1 }] },
    { status: "active", items: [{ unitAmount: 1900, quantity: 2, currency: "sek", interval: "month", intervalCount: 1 }] },
    { status: "trialing", items: [{ unitAmount: 7900, quantity: 1, currency: "sek", interval: "month", intervalCount: 1 }] },
    { status: "canceled", items: [{ unitAmount: 7900, quantity: 1, currency: "sek", interval: "month", intervalCount: 1 }] },
  ]);
  assert.equal(r.activeSubscriptions, 4);
  assert.equal(r.mrr, Math.round(7900 + 59900 / 12 + 3800));
  assert.ok(Number.isInteger(r.mrr));
});

test("buildRevenueBlock summerar källor i öre och utelämnar saknade källor", () => {
  const days = seriesDays(new Date("2026-10-23T12:00:00Z"));
  const admob = admobToMinor([
    { day: "2026-10-23", earnings: 1.234 },
    { day: "2026-10-22", earnings: 10.5 },
  ]);
  assert.equal(admob.get("2026-10-23"), 123);
  const stripe = {
    perDay: new Map([["2026-10-22", { gross: 7900, net: 7400 }]]),
    mrr: 7900,
    activeSubscriptions: 1,
  };
  const r = buildRevenueBlock(days, stripe, admob);
  assert.equal(r.currency, "SEK");
  assert.equal(r.gross31d, 7900 + 1050 + 123);
  assert.equal(r.net31d, 7400 + 1050 + 123);
  assert.equal(r.mrr, 7900);
  assert.deepEqual(r.bySource.map((s) => s.source), ["stripe", "admob"]);
  assert.deepEqual(r.series.map((s) => s.key), ["revenue_gross", "revenue_net", "revenue_stripe", "revenue_admob"]);
  for (const s of r.series) {
    assert.equal(s.points.length, 31);
    assert.equal(s.unit, "minor");
    assert.ok(s.points.every((p) => Number.isInteger(p.value)));
  }

  const onlyAdmob = buildRevenueBlock(days, null, admob);
  assert.equal(onlyAdmob.mrr, null);
  assert.equal(onlyAdmob.activeSubscriptions, null);
  assert.deepEqual(onlyAdmob.bySource.map((s) => s.source), ["admob"]);

  const none = buildRevenueBlock(days, null, null);
  assert.equal(none.gross31d, 0);
  assert.equal(none.net31d, null);
  assert.equal(none.bySource.length, 0);
});

console.log(`\n${n} tester gick igenom`);
