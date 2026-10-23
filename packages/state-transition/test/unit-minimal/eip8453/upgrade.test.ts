import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {FAR_FUTURE_EPOCH, ForkName, MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {createCachedBeaconState} from "../../../src/cache/stateCache.js";
import {upgradeStateToEip8453} from "../../../src/slot/upgradeStateToEip8453.js";
import {CachedBeaconStateHeze} from "../../../src/types.js";
import {interopSecretKeys} from "../../../src/util/interop.js";

describe("upgradeStateToEip8453", () => {
  it("starts the finality gadget from the Casper FFG finalized checkpoint and the latest block", () => {
    const validatorCount = 16;
    const forkEpoch = 2;
    const config = getConfig(ForkName.eip8453, forkEpoch);
    const view = ssz.heze.BeaconState.defaultViewDU();
    const justifiedRoot = new Uint8Array(32).fill(0xaa);
    const finalizedRoot = new Uint8Array(32).fill(0xbb);

    view.slot = forkEpoch * SLOTS_PER_EPOCH;
    view.fork = ssz.phase0.Fork.toViewDU({
      previousVersion: config.GLOAS_FORK_VERSION,
      currentVersion: config.HEZE_FORK_VERSION,
      epoch: 0,
    });
    view.latestBlockHeader = ssz.phase0.BeaconBlockHeader.toViewDU({
      slot: forkEpoch * SLOTS_PER_EPOCH - 1,
      proposerIndex: 3,
      parentRoot: new Uint8Array(32).fill(0x01),
      stateRoot: new Uint8Array(32).fill(0x02),
      bodyRoot: new Uint8Array(32).fill(0x03),
    });
    view.currentJustifiedCheckpoint = ssz.phase0.Checkpoint.toViewDU({epoch: 1, root: justifiedRoot});
    view.finalizedCheckpoint = ssz.phase0.Checkpoint.toViewDU({epoch: 1, root: finalizedRoot});
    view.validators = ssz.gloas.Validators.toViewDU(
      interopSecretKeys(validatorCount).map((sk) => ({
        pubkey: sk.toPublicKey().toBytes(),
        withdrawalCredentials: new Uint8Array(32).fill(1),
        effectiveBalance: MAX_EFFECTIVE_BALANCE,
        slashed: false,
        activationEligibilityEpoch: 0,
        activationEpoch: 0,
        exitEpoch: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      }))
    );
    const zeros = Array.from({length: validatorCount}, () => 0);
    view.balances = ssz.gloas.Balances.toViewDU(zeros.map(() => MAX_EFFECTIVE_BALANCE));
    view.inactivityScores = ssz.gloas.InactivityScores.toViewDU(zeros.map((_, i) => i));
    view.previousEpochParticipation = ssz.gloas.EpochParticipation.toViewDU(zeros.map(() => 0b111));
    view.currentEpochParticipation = ssz.gloas.EpochParticipation.toViewDU(zeros.map(() => 0b1));

    const stateHeze = createCachedBeaconState(
      view,
      {config: createBeaconConfig(config, view.genesisValidatorsRoot), pubkeyCache},
      {skipSyncCommitteeCache: true}
    ) as CachedBeaconStateHeze;
    const latestBlockRoot = stateHeze.latestBlockHeader.hashTreeRoot();

    const post = upgradeStateToEip8453(stateHeze);

    expect(post.fork.currentVersion).toEqual(config.EIP8453_FORK_VERSION);
    expect(post.fork.previousVersion).toEqual(config.HEZE_FORK_VERSION);
    expect(post.fork.epoch).toBe(forkEpoch);
    expect(post.targetCheckpoint.toValue()).toEqual({height: 1, root: latestBlockRoot});
    expect(post.justifiedCheckpoint.toValue()).toEqual({height: 0, root: finalizedRoot});
    expect(post.finalizedCheckpoint.toValue()).toEqual({height: 0, root: finalizedRoot});
    expect(post.targetSlot).toBe(forkEpoch * SLOTS_PER_EPOCH - 1);
    expect(post.finalizedSlot).toBe(SLOTS_PER_EPOCH);
    expect(post.targetParticipation.getAll()).toEqual(zeros.map(() => false));
    expect(post.progressParticipation.getAll()).toEqual(zeros.map(() => false));
    expect(post.roundParticipation.getAll()).toEqual(zeros);
    expect(post.pendingFinality.length).toBe(0);
    expect(post.headVoteParticipation.length).toBe(2 * SLOTS_PER_EPOCH);
    expect(post.inactivityScores.getAll()).toEqual(zeros.map((_, i) => i));
    expect(post.validators.length).toBe(validatorCount);
    // the removed fields are not present on the view
    expect((post as unknown as Record<string, unknown>).previousEpochParticipation).toBeUndefined();
    expect(post.hashTreeRoot()).toHaveLength(32);
  });
});
