import {describe, it} from "vitest";
import {ChainConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot, ssz} from "@lodestar/types";
import {ProposerPreferencesErrorCode} from "../../../../src/chain/errors/index.js";
import {IBeaconChain} from "../../../../src/chain/index.js";
import {validateGossipProposerPreferences} from "../../../../src/chain/validation/proposerPreferences.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";

describe("validate proposer preferences", () => {
  const GLOAS_FORK_EPOCH = 2;
  const config = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 1,
    GLOAS_FORK_EPOCH,
  } as Partial<ChainConfig>);
  const gloasStartSlot = GLOAS_FORK_EPOCH * SLOTS_PER_EPOCH;

  function getChainStub(currentSlot: Slot): IBeaconChain {
    return {config, clock: {currentSlotWithGossipDisparity: currentSlot}} as Partial<IBeaconChain> as IBeaconChain;
  }

  function getProposerPreferences(
    proposalSlot: Slot
  ): ReturnType<typeof ssz.gloas.SignedProposerPreferences.defaultValue> {
    const signedProposerPreferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    signedProposerPreferences.message.proposalSlot = proposalSlot;
    return signedProposerPreferences;
  }

  // The Gloas topics are subscribed one epoch before the fork, a peer may publish preferences for a
  // proposal slot that is still pre-Gloas on that topic
  it("should ignore preferences for a pre-gloas proposal slot", async () => {
    await expectRejectedWithLodestarError(
      validateGossipProposerPreferences(getChainStub(gloasStartSlot - 2), getProposerPreferences(gloasStartSlot - 1)),
      ProposerPreferencesErrorCode.PRE_GLOAS_PROPOSAL_SLOT
    );
  });

  it("should not ignore preferences for a gloas proposal slot", async () => {
    // Fails on the lookahead check instead, which is the check right after the fork guard
    await expectRejectedWithLodestarError(
      validateGossipProposerPreferences(getChainStub(0), getProposerPreferences(gloasStartSlot)),
      ProposerPreferencesErrorCode.INVALID_EPOCH
    );
  });
});
