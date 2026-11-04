import { describe, it, expect } from "vitest";
import { isMoneyRelated, isSweepOrBatchCandidate } from "@/lib/services/archive-sweep";

describe("Sweep Archive Logic", () => {
  it("identifies sweep and batch titles correctly", () => {
    expect(isSweepOrBatchCandidate("7 Sept Instagram batch — 10 sent", "follow_up")).toBe(true);
    expect(isSweepOrBatchCandidate("11 Sept sweep — where every thread actually stands", "follow_up")).toBe(true);
    expect(isSweepOrBatchCandidate("Morning sweep 30 Sept 07:20 UTC", "chore")).toBe(true);
    expect(isSweepOrBatchCandidate("Evening sweep 29 Sept 19:2x UTC", "chore")).toBe(true);
    expect(isSweepOrBatchCandidate("Sweep Fri 25 Sept", "follow_up")).toBe(true);
    expect(isSweepOrBatchCandidate("Monday 14 Sept sweep", "follow_up")).toBe(true);
    expect(isSweepOrBatchCandidate("Night sweep 25 Oct 22:1x UTC", "chore")).toBe(true);
  });

  it("NEVER archives rows tied to money, payouts, withdrawals or refunds", () => {
    // Money in title
    expect(isSweepOrBatchCandidate("Payout complaint from organizer on 12 Sept sweep", "escalation")).toBe(false);
    expect(isSweepOrBatchCandidate("Withdrawal delay for event tickets on 15 Sept batch", "decision")).toBe(false);
    expect(isSweepOrBatchCandidate("Customer asking for refund for cancelled festival", "escalation")).toBe(false);
    expect(isSweepOrBatchCandidate("14 Sept sweep: ticket money paid out", "chore")).toBe(false);
    expect(isSweepOrBatchCandidate("Organizer fee dispute from 10 Sept batch", "decision")).toBe(false);
    expect(isSweepOrBatchCandidate("Unpaid balance escalation", "escalation")).toBe(false);

    // Money in body or why
    expect(
      isSweepOrBatchCandidate(
        "Morning sweep 18 Sept",
        "chore",
        "Organizer reached out regarding pending payout of N500,000",
        null
      )
    ).toBe(false);

    expect(
      isSweepOrBatchCandidate(
        "19 Sept batch report",
        "follow_up",
        null,
        "Organizer complained about missing funds from ticket sales"
      )
    ).toBe(false);
  });

  it("detects money keywords across variations", () => {
    expect(isMoneyRelated("Urgent: payout failed")).toBe(true);
    expect(isMoneyRelated("Where is my withdrawal?")).toBe(true);
    expect(isMoneyRelated("Process refund immediately")).toBe(true);
    expect(isMoneyRelated("We have paid the balance")).toBe(true);
    expect(isMoneyRelated("Routine design update")).toBe(false);
  });
});
