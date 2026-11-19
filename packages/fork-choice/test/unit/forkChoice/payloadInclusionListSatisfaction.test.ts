import {describe, expect, it, vi} from "vitest";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {ExecutionStatus, ForkChoice, ForkChoiceMetrics, PayloadStatus} from "../../../src/index.js";
import {getPayloadBlockHash, gloasConfig, headSlot, hezeConfig, makeStore, setup} from "./proposerHeadTestUtils.js";

/** Deliver the execution payload envelope for a block, creating its FULL variant. */
function deliverPayload(forkChoice: ForkChoice, blockRoot: RootHex): void {
  forkChoice.onExecutionPayload(
    blockRoot,
    getPayloadBlockHash(headSlot),
    headSlot,
    30_000_000,
    ExecutionStatus.Valid,
    DataAvailabilityStatus.Available
  );
}

describe("ForkChoice payload inclusion list satisfaction", () => {
  describe("isPayloadInclusionListSatisfied", () => {
    it("is false for a block with no recorded satisfaction", () => {
      const {forkChoice, headRoot} = setup({isGloas: true, config: hezeConfig});

      expect(forkChoice.isPayloadInclusionListSatisfied(headRoot)).toBe(false);
    });

    it("is false while the payload has not been delivered, even when recorded satisfied", () => {
      const {forkChoice, headRoot} = setup({isGloas: true, config: hezeConfig});
      forkChoice.recordPayloadInclusionListSatisfaction(headRoot, true);

      // setup() leaves the head on its PENDING variant, so no payload envelope has been received
      expect(forkChoice.isPayloadInclusionListSatisfied(headRoot)).toBe(false);
    });

    it("is true once the payload is delivered and satisfaction was recorded", () => {
      const {forkChoice, headRoot} = setup({isGloas: true, config: hezeConfig});
      deliverPayload(forkChoice, headRoot);
      forkChoice.recordPayloadInclusionListSatisfaction(headRoot, true);

      expect(forkChoice.isPayloadInclusionListSatisfied(headRoot)).toBe(true);
    });

    it("is false once the payload is delivered but recorded unsatisfied", () => {
      const {forkChoice, headRoot} = setup({isGloas: true, config: hezeConfig});
      deliverPayload(forkChoice, headRoot);
      forkChoice.recordPayloadInclusionListSatisfaction(headRoot, false);

      expect(forkChoice.isPayloadInclusionListSatisfied(headRoot)).toBe(false);
    });
  });

  describe("unsatisfied inclusion list metric", () => {
    it("counts a block once when its payload is recorded unsatisfied, not per head evaluation", () => {
      const inc = vi.fn();
      const metrics = {
        forkChoice: {votes: {addCollect: vi.fn()}, unsatisfiedInclusionListBlocks: {inc}},
      } as unknown as ForkChoiceMetrics;
      const {forkChoice, headRoot} = setup({isGloas: true, config: hezeConfig, metrics});
      deliverPayload(forkChoice, headRoot);

      expect(forkChoice.recordPayloadInclusionListSatisfaction(headRoot, true)).toBe(true);
      expect(inc).not.toHaveBeenCalled();

      expect(forkChoice.recordPayloadInclusionListSatisfaction(headRoot, false)).toBe(true);
      expect(forkChoice.recordPayloadInclusionListSatisfaction(headRoot, false)).toBe(false);
      expect(inc).toHaveBeenCalledTimes(1);

      expect(forkChoice.updateHead().payloadStatus).toBe(PayloadStatus.EMPTY);
      expect(forkChoice.updateHead().payloadStatus).toBe(PayloadStatus.EMPTY);
      expect(inc).toHaveBeenCalledTimes(1);
    });
  });

  describe("head during the block's own slot", () => {
    it("moves to the EMPTY variant once the payload is recorded unsatisfied", () => {
      const store = {...makeStore(), currentSlot: headSlot};
      const {forkChoice, headRoot} = setup({isGloas: true, config: hezeConfig, store});
      deliverPayload(forkChoice, headRoot);
      expect(forkChoice.updateHead().payloadStatus).toBe(PayloadStatus.FULL);

      forkChoice.recordPayloadInclusionListSatisfaction(headRoot, false);
      const head = forkChoice.updateHead();
      expect(head.blockRoot).toBe(headRoot);
      expect(head.payloadStatus).toBe(PayloadStatus.EMPTY);
    });
  });

  describe("head during the next slot", () => {
    it("stays on the EMPTY variant while the payload is recorded unsatisfied", () => {
      const {forkChoice, headRoot} = setup({isGloas: true, config: hezeConfig});
      deliverPayload(forkChoice, headRoot);
      forkChoice.recordPayloadInclusionListSatisfaction(headRoot, false);
      expect(forkChoice.updateHead().payloadStatus).toBe(PayloadStatus.EMPTY);

      forkChoice.recordPayloadInclusionListSatisfaction(headRoot, true);
      const head = forkChoice.updateHead();
      expect(head.blockRoot).toBe(headRoot);
      expect(head.payloadStatus).toBe(PayloadStatus.FULL);
    });

    it("does not apply the inclusion list gate pre-heze", () => {
      const {forkChoice, headRoot} = setup({isGloas: true, config: gloasConfig});
      deliverPayload(forkChoice, headRoot);

      expect(forkChoice.updateHead().payloadStatus).toBe(PayloadStatus.FULL);
    });
  });

  describe("head after the next slot", () => {
    it("returns to the FULL variant of a payload recorded unsatisfied", () => {
      const store = {...makeStore(), currentSlot: headSlot + 2};
      const {forkChoice, headRoot} = setup({isGloas: true, config: hezeConfig, store});
      deliverPayload(forkChoice, headRoot);
      forkChoice.recordPayloadInclusionListSatisfaction(headRoot, false);

      const head = forkChoice.updateHead();
      expect(head.blockRoot).toBe(headRoot);
      expect(head.payloadStatus).toBe(PayloadStatus.FULL);
    });
  });

  describe("shouldExtendPayload", () => {
    it("does not consider the inclusion list verdict", () => {
      const {forkChoice, headRoot} = setup({isGloas: true, config: hezeConfig});
      deliverPayload(forkChoice, headRoot);
      forkChoice.recordPayloadInclusionListSatisfaction(headRoot, false);

      expect(forkChoice.shouldExtendPayload(headRoot)).toBe(true);
    });
  });
});
