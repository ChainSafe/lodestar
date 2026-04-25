import {describe, expect, it} from "vitest";
import {ForkSeq} from "@lodestar/params";
import {canKnownBlockRequireExecutionPayloadEnvelope} from "../../../src/network/processor/executionPayloadEnvelopeEligibility.js";

describe("canKnownBlockRequireExecutionPayloadEnvelope", () => {
  const gloasFromSlot1 = (slot: number): ForkSeq => (slot >= 1 ? ForkSeq.gloas : ForkSeq.deneb);

  it("returns false for genesis even when current fork is gloas-era", () => {
    expect(canKnownBlockRequireExecutionPayloadEnvelope(gloasFromSlot1, {slot: 0})).toBe(false);
  });

  it("returns false for known pre-gloas blocks", () => {
    expect(canKnownBlockRequireExecutionPayloadEnvelope(() => ForkSeq.deneb, {slot: 64})).toBe(false);
  });

  it("returns true for known post-gloas non-genesis blocks", () => {
    expect(canKnownBlockRequireExecutionPayloadEnvelope(() => ForkSeq.gloas, {slot: 1})).toBe(true);
    expect(canKnownBlockRequireExecutionPayloadEnvelope(() => ForkSeq.gloas, {slot: 128})).toBe(true);
  });

  it("returns true for unknown blocks so sync can still recover real post-gloas roots", () => {
    expect(canKnownBlockRequireExecutionPayloadEnvelope(() => ForkSeq.gloas, null)).toBe(true);
  });
});
