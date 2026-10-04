import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {FAR_FUTURE_EPOCH, ForkName, MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {createCachedBeaconState} from "../../../src/cache/stateCache.js";
import {upgradeStateToDecoupled} from "../../../src/slot/upgradeStateToDecoupled.js";
import {CachedBeaconStateHeze} from "../../../src/types.js";
import {interopSecretKeys} from "../../../src/util/interop.js";

describe("upgradeStateToDecoupled", () => {
  it("initializes the height pairs from the fork's latest block and the legacy checkpoints", () => {
    const validatorCount = 16;
    const forkEpoch = 2;
    const config = getConfig(ForkName.decoupled, forkEpoch);
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
    view.finalizedCheckpoint = ssz.phase0.Checkpoint.toViewDU({epoch: 0, root: finalizedRoot});
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
    view.inactivityScores = ssz.gloas.InactivityScores.toViewDU(zeros);
    view.previousEpochParticipation = ssz.gloas.EpochParticipation.toViewDU(zeros.map(() => 0b111));
    view.currentEpochParticipation = ssz.gloas.EpochParticipation.toViewDU(zeros.map(() => 0b1));

    const stateHeze = createCachedBeaconState(
      view,
      {config: createBeaconConfig(config, view.genesisValidatorsRoot), pubkeyCache},
      {skipSyncCommitteeCache: true}
    ) as CachedBeaconStateHeze;

    const stateDecoupled = upgradeStateToDecoupled(stateHeze);
    expect(() => stateDecoupled.toValue()).not.toThrow();
    expect(stateDecoupled.hashTreeRoot()).toHaveLength(32);

    expect(stateDecoupled.fork.previousVersion).toEqual(config.HEZE_FORK_VERSION);
    expect(stateDecoupled.fork.currentVersion).toEqual(config.DECOUPLED_FORK_VERSION);
    expect(stateDecoupled.fork.epoch).toBe(forkEpoch);

    expect(stateDecoupled.targetPair.height).toBe(1);
    expect(stateDecoupled.targetPair.root).toEqual(stateHeze.latestBlockHeader.hashTreeRoot());
    expect(stateDecoupled.targetSlot).toBe(forkEpoch * SLOTS_PER_EPOCH - 1);
    expect(stateDecoupled.justifiedPair.height).toBe(0);
    expect(stateDecoupled.justifiedPair.root).toEqual(justifiedRoot);
    expect(stateDecoupled.justifiedSlot).toBe(SLOTS_PER_EPOCH);
    expect(stateDecoupled.finalizedPair.height).toBe(0);
    expect(stateDecoupled.finalizedPair.root).toEqual(finalizedRoot);
    expect(stateDecoupled.finalizedSlot).toBe(0);

    for (const list of [
      stateDecoupled.heightParticipation,
      stateDecoupled.previousRoundParticipation,
      stateDecoupled.currentRoundParticipation,
    ]) {
      expect(list.length).toBe(validatorCount);
      expect(Array.from(list.getAll()).every((f) => f === 0)).toBe(true);
    }
    expect(Array.from(stateDecoupled.previousEpochParticipation.getAll()).every((f) => f === 0b111)).toBe(true);
    expect(stateDecoupled.builderPaymentParticipation.length).toBe(2 * SLOTS_PER_EPOCH);
    expect(stateDecoupled.builderPaymentParticipation.getReadonly(0).length).toBe(0);
    expect(stateDecoupled.validators.length).toBe(validatorCount);
    expect(stateDecoupled.finalizedCheckpoint.root).toEqual(finalizedRoot);
  });
});
