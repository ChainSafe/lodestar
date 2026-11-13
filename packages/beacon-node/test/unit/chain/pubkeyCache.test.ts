import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {IBeaconStateView, interopSecretKey, promoteFinalizedPubkeys} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {BeaconChain} from "../../../src/chain/chain.js";
import {getMockedLogger} from "../../mocks/loggerMock.js";

function validator(index: number, activationEligibilityEpoch = FAR_FUTURE_EPOCH): phase0.Validator {
  return {
    ...ssz.phase0.Validator.defaultValue(),
    pubkey: interopSecretKey(index).toPublicKey().toBytes(),
    activationEligibilityEpoch,
  };
}

function view(validators: phase0.Validator[]): Pick<IBeaconStateView, "validatorCount" | "getValidator"> {
  return {validatorCount: validators.length, getValidator: (index) => validators[index]};
}

describe("finalized validator pubkeys", () => {
  beforeEach(() => pubkeyCache.reset());
  afterEach(() => pubkeyCache.reset());

  it("promotes the canonical prefix and prunes conflicting candidates only below it", () => {
    const anchor = validator(0, 0);
    const side = validator(1, 5);
    const canonical = validator(2, 5);
    const trailing = validator(3);
    pubkeyCache.append(0, anchor.pubkey);
    pubkeyCache.addCandidate(1, side.pubkey);
    pubkeyCache.addCandidate(1, canonical.pubkey);
    pubkeyCache.addCandidate(2, canonical.pubkey);
    pubkeyCache.addCandidate(2, trailing.pubkey);
    const state = view([anchor, canonical, trailing]);

    promoteFinalizedPubkeys(pubkeyCache, state, 4);
    expect(pubkeyCache.size).toBe(1);

    promoteFinalizedPubkeys(pubkeyCache, state, 5);
    expect(pubkeyCache.size).toBe(2);
    expect(pubkeyCache.getPubkeyBytes(1)).toEqual(canonical.pubkey);
    expect(pubkeyCache.getCandidates(side.pubkey)).toEqual([]);
    expect(pubkeyCache.getCandidates(canonical.pubkey)).toEqual([2]);
    expect(pubkeyCache.getCandidates(trailing.pubkey)).toEqual([2]);
    expect(pubkeyCache.getIndex(trailing.pubkey)).toBeNull();
  });

  it("includes earlier ineligible validators but leaves the trailing ones as candidates", () => {
    const validators = [validator(0, 0), validator(1), validator(2, 3), validator(3)];
    pubkeyCache.append(0, validators[0].pubkey);
    for (let index = 1; index < validators.length; index++) {
      pubkeyCache.addCandidate(index, validators[index].pubkey);
    }

    promoteFinalizedPubkeys(pubkeyCache, view(validators), 3);

    expect(pubkeyCache.size).toBe(3);
    for (let index = 0; index < pubkeyCache.size; index++) {
      expect(pubkeyCache.getPubkeyBytes(index), `pubkey ${index}`).toEqual(validators[index].pubkey);
    }
    expect(pubkeyCache.getCandidates(validators[3].pubkey)).toEqual([3]);
  });

  it("does not shrink the finalized prefix when the state has fewer validators", () => {
    const anchor = validator(0, 0);
    pubkeyCache.append(0, anchor.pubkey);

    promoteFinalizedPubkeys(pubkeyCache, view([]), 1);

    expect(pubkeyCache.size).toBe(1);
    expect(pubkeyCache.getPubkeyBytes(0)).toEqual(anchor.pubkey);
  });

  it.each([false, true])("promotes after a clock tick only if finality advances: %s", (advance) => {
    const validators = [validator(0, 0), validator(1, 2)];
    pubkeyCache.append(0, validators[0].pubkey);
    pubkeyCache.addCandidate(1, validators[1].pubkey);
    let finalizedEpoch = 1;
    const prune = {prune: vi.fn()};
    const chain = {
      logger: getMockedLogger(),
      pubkeyCache,
      pubkeyCacheFinalizedEpoch: 1,
      pubkeyCachePromotion: null,
      forkChoice: {
        getHead: () => ({slot: 0}),
        getFinalizedCheckpoint: () => ({epoch: finalizedEpoch}),
        updateTime: vi.fn(() => {
          if (advance) finalizedEpoch = 2;
        }),
      },
      regen: {getClosestHeadState: vi.fn(() => view(validators))},
      updateFinalizedPubkeys: BeaconChain.prototype.updateFinalizedPubkeys,
      emitHeadEvents: vi.fn(),
      attestationPool: prune,
      aggregatedAttestationPool: prune,
      proposerTracker: prune,
      singleAttestationPool: prune,
      syncCommitteeMessagePool: prune,
      seenSyncCommitteeMessages: prune,
      payloadAttestationPool: prune,
      executionPayloadBidPool: prune,
      seenExecutionPayloadBids: prune,
      proposerPreferencesPool: prune,
      inclusionListStore: prune,
      seenAttestationDatas: {onSlot: vi.fn()},
      reprocessController: {onSlot: vi.fn()},
      blockProductionCache: new Set(),
      opts: {},
    };

    BeaconChain.prototype["onClockSlot"].call(chain as unknown as BeaconChain, 64);

    expect(pubkeyCache.size).toBe(advance ? 2 : 1);
    expect(chain.regen.getClosestHeadState).toHaveBeenCalledTimes(advance ? 1 : 0);
    if (advance) {
      expect(chain.forkChoice.updateTime.mock.invocationCallOrder[0]).toBeLessThan(
        chain.regen.getClosestHeadState.mock.invocationCallOrder[0]
      );
    }
  });

  it("reloads a missing head and retries a failed reload without losing the finalization", async () => {
    const validators = [validator(0, 0), validator(1, 2)];
    pubkeyCache.append(0, validators[0].pubkey);
    pubkeyCache.addCandidate(1, validators[1].pubkey);
    const chain = {
      logger: getMockedLogger(),
      pubkeyCache,
      pubkeyCacheFinalizedEpoch: 1,
      pubkeyCachePromotion: null as Promise<void> | null,
      forkChoice: {
        getHead: () => ({stateRoot: "0x01"}),
        getFinalizedCheckpoint: () => ({epoch: 2}),
      },
      regen: {
        getClosestHeadState: vi.fn().mockReturnValue(null),
        getState: vi.fn().mockRejectedValueOnce(new Error("state unavailable")).mockResolvedValue(view(validators)),
      },
    };

    BeaconChain.prototype.updateFinalizedPubkeys.call(chain as unknown as BeaconChain);
    BeaconChain.prototype.updateFinalizedPubkeys.call(chain as unknown as BeaconChain);
    expect(chain.regen.getState).toHaveBeenCalledTimes(1);
    await chain.pubkeyCachePromotion;
    expect(pubkeyCache.size).toBe(1);
    expect(chain.pubkeyCacheFinalizedEpoch).toBe(1);

    BeaconChain.prototype.updateFinalizedPubkeys.call(chain as unknown as BeaconChain);
    await chain.pubkeyCachePromotion;
    expect(pubkeyCache.size).toBe(2);
    expect(chain.pubkeyCacheFinalizedEpoch).toBe(2);

    BeaconChain.prototype.updateFinalizedPubkeys.call(chain as unknown as BeaconChain);
    expect(chain.regen.getState).toHaveBeenCalledTimes(2);
    expect(chain.regen.getClosestHeadState).toHaveBeenCalledTimes(2);
  });

  it("promotes a newer checkpoint after an earlier head reload finishes", async () => {
    const validators = [validator(0, 0), validator(1, 2), validator(2, 3)];
    const {promise, resolve} = defer<Pick<IBeaconStateView, "validatorCount" | "getValidator">>();
    pubkeyCache.append(0, validators[0].pubkey);
    let finalizedEpoch = 2;
    const chain = {
      logger: getMockedLogger(),
      pubkeyCache,
      pubkeyCacheFinalizedEpoch: 1,
      pubkeyCachePromotion: null as Promise<void> | null,
      forkChoice: {
        getHead: () => ({stateRoot: "0x01"}),
        getFinalizedCheckpoint: () => ({epoch: finalizedEpoch}),
      },
      regen: {
        getClosestHeadState: vi.fn().mockReturnValueOnce(null).mockReturnValue(view(validators)),
        getState: vi.fn().mockReturnValue(promise),
      },
    };

    BeaconChain.prototype.updateFinalizedPubkeys.call(chain as unknown as BeaconChain);
    finalizedEpoch = 3;
    BeaconChain.prototype.updateFinalizedPubkeys.call(chain as unknown as BeaconChain);
    resolve(view(validators.slice(0, 2)));
    await chain.pubkeyCachePromotion;
    expect(pubkeyCache.size).toBe(2);
    expect(chain.pubkeyCacheFinalizedEpoch).toBe(2);

    BeaconChain.prototype.updateFinalizedPubkeys.call(chain as unknown as BeaconChain);
    expect(pubkeyCache.size).toBe(3);
    expect(chain.pubkeyCacheFinalizedEpoch).toBe(3);
    expect(chain.regen.getState).toHaveBeenCalledTimes(1);
  });
});
