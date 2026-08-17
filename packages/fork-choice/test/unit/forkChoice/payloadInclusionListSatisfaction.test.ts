import {describe, expect, it} from "vitest";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {ExecutionStatus, ForkChoice} from "../../../src/index.js";
import {getPayloadBlockHash, gloasConfig, headSlot, hezeConfig, setup} from "./proposerHeadTestUtils.js";

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

  describe("shouldExtendPayload", () => {
    it("refuses to extend a heze payload that did not satisfy the constraints", () => {
      const {forkChoice, headRoot} = setup({isGloas: true, config: hezeConfig});
      deliverPayload(forkChoice, headRoot);
      forkChoice.recordPayloadInclusionListSatisfaction(headRoot, false);

      expect(forkChoice.shouldExtendPayload(headRoot)).toBe(false);
    });

    it("does not apply the inclusion list gate pre-heze", () => {
      const {forkChoice, headRoot} = setup({isGloas: true, config: gloasConfig});
      deliverPayload(forkChoice, headRoot);
      // Nothing recorded, which post-heze would block extension
      expect(forkChoice.shouldExtendPayload(headRoot)).toBe(true);
    });
  });
});
