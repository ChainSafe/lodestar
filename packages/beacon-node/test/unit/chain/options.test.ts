import {describe, expect, it} from "vitest";
import {
  DEFAULT_ADVERSARIAL_REORG_LAST_SLOT_PROPOSAL_DELAY_BPS,
  defaultChainOptions,
} from "../../../src/chain/options.js";

describe("defaultChainOptions", () => {
  it("should disable all adversarial behaviors", () => {
    expect(defaultChainOptions.adversarialReorgBuildOnEmpty).toBe(false);
    expect(defaultChainOptions.adversarialReorgOmitPtcAttestations).toBe(false);
    expect(defaultChainOptions.adversarialReorgDelayLastSlotProposal).toBe(false);
    expect(defaultChainOptions.adversarialReorgBuildOnParentInLastSlot).toBe(false);
    expect(defaultChainOptions.adversarialReorgLastSlotProposalDelayBps).toBe(
      DEFAULT_ADVERSARIAL_REORG_LAST_SLOT_PROPOSAL_DELAY_BPS
    );
    expect(DEFAULT_ADVERSARIAL_REORG_LAST_SLOT_PROPOSAL_DELAY_BPS).toBe(4_000);
  });
});
