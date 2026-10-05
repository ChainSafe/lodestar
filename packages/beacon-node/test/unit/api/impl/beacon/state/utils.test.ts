import {Mock, describe, expect, it, vi} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
import {getStateResponseWithRegen, getStateValidatorIndex} from "../../../../../../src/api/impl/beacon/state/utils.js";
import {NodeIsSyncing} from "../../../../../../src/api/impl/errors.js";
import {IBeaconChain} from "../../../../../../src/chain/index.js";
import {IBeaconSync, SyncState} from "../../../../../../src/sync/index.js";
import {generateCachedAltairState} from "../../../../../utils/state.js";

describe("beacon state api utils", () => {
  describe("getStateValidatorIndex", () => {
    const state = new BeaconStateView(generateCachedAltairState());
    const pubkeyCache = state.cachedState.epochCtx.pubkeyCache;

    it("should return valid: false on invalid input", () => {
      // "invalid validator id number"
      expect(getStateValidatorIndex("foo", state, pubkeyCache).valid).toBe(false);
      // "invalid hex"
      expect(getStateValidatorIndex("0xfoo", state, pubkeyCache).valid).toBe(false);
      // "negative validator index"
      expect(getStateValidatorIndex("-1", state, pubkeyCache).valid).toBe(false);
      expect(getStateValidatorIndex(-1, state, pubkeyCache).valid).toBe(false);
    });

    it("should return valid: false on validator indices / pubkeys not in the state", () => {
      // "validator id not in state"
      expect(getStateValidatorIndex(String(state.validatorCount), state, pubkeyCache).valid).toBe(false);
      // "validator pubkey not in state"
      expect(
        getStateValidatorIndex(
          "0xa99af0913a2834ef4959637e8d7c4e17f0b63adc587d36ab43510452db3102d0771a4554ea4118a33913827d5ee80b76",
          state,
          pubkeyCache
        ).valid
      ).toBe(false);
    });

    it("should return valid: true on validator indices / pubkeys in the state", () => {
      const index = state.validatorCount - 1;
      const resp1 = getStateValidatorIndex(String(index), state, pubkeyCache);
      if (resp1.valid) {
        expect(resp1.validatorIndex).toBe(index);
      } else {
        expect.fail("validator index should be found - validator index as string input");
      }
      const resp2 = getStateValidatorIndex(index, state, pubkeyCache);
      if (resp2.valid) {
        expect(resp2.validatorIndex).toBe(index);
      } else {
        expect.fail("validator index should be found - validator index as number input");
      }
      const pubkey = state.getValidator(index).pubkey;
      const resp3 = getStateValidatorIndex(pubkey, state, pubkeyCache);
      if (resp3.valid) {
        expect(resp3.validatorIndex).toBe(index);
      } else {
        expect.fail("validator index should be found - Uint8Array input");
      }
      const resp4 = getStateValidatorIndex(toHexString(pubkey), state, pubkeyCache);
      if (resp4.valid) {
        expect(resp4.validatorIndex).toBe(index);
      } else {
        expect.fail("validator index should be found - Uint8Array input");
      }
    });
  });

  describe("getStateResponseWithRegen", () => {
    // Node far behind head and syncing. Chain getters return a dummy response so the resolved
    // "already-available" state ids don't blow up; the regen paths are never reached in these tests.
    const servedResponse = {state: {}, executionOptimistic: false, finalized: false};
    const syncingChain = {
      clock: {currentSlot: 10 * SLOTS_PER_EPOCH},
      forkChoice: {
        getHead: () => ({slot: 0, stateRoot: "0x00"}),
        getFinalizedCheckpoint: () => ({rootHex: "0x00", epoch: 0}),
        getJustifiedCheckpoint: () => ({rootHex: "0x00", epoch: 0}),
        getFinalizedBlock: () => ({slot: 0}),
      },
      regen: {getStateSync: () => servedResponse.state},
      getStateByStateRoot: () => Promise.resolve(servedResponse),
      getStateOrBytesByCheckpoint: () => Promise.resolve(servedResponse),
      getStateBySlot: () => Promise.resolve(servedResponse),
      getHistoricalStateBySlot: () => Promise.resolve(servedResponse),
    } as unknown as IBeaconChain;
    const sync = {state: SyncState.SyncingFinalized} as unknown as IBeaconSync;

    it("throws NodeIsSyncing for a regen-triggering slot while the node is behind and syncing", async () => {
      // notWhileSyncing runs before any regen, so a minimal clock/forkChoice/sync mock is enough
      await expect(getStateResponseWithRegen(syncingChain, sync, 5 * SLOTS_PER_EPOCH)).rejects.toThrow(NodeIsSyncing);
    });

    it("serves head/finalized/justified/genesis while syncing (no regen wedge risk)", async () => {
      for (const stateId of ["head", "finalized", "justified", "genesis"] as const) {
        await expect(getStateResponseWithRegen(syncingChain, sync, stateId), stateId).resolves.toBeDefined();
      }
    });
  });

  describe("getStateResponseWithRegen head", () => {
    const head = {slot: 15902, stateRoot: "0xaa", executionStatus: ExecutionStatus.Valid};
    const headPostState = {epoch: 496, slot: 15902};
    // Anchor state at the epoch boundary after the head block, slots 15903-15904 skipped
    const anchorState = {epoch: 497, slot: 15904};
    const sync = {state: SyncState.Synced} as unknown as IBeaconSync;

    function getChain(cachedState: unknown): {chain: IBeaconChain; getHeadState: Mock} {
      const getHeadState = vi.fn(() => anchorState);
      const chain = {
        forkChoice: {
          getHead: () => head,
          getFinalizedCheckpoint: () => ({rootHex: "0xbb", epoch: 497}),
        },
        regen: {getStateSync: (stateRoot: string) => (stateRoot === head.stateRoot ? cachedState : null)},
        getHeadState,
      } as unknown as IBeaconChain;
      return {chain, getHeadState};
    }

    it("serves the head block's post-state from the block state cache", async () => {
      const {chain, getHeadState} = getChain(headPostState);
      const res = await getStateResponseWithRegen(chain, sync, "head");
      expect(res.state).toBe(headPostState);
      expect(res.finalized).toBe(true);
      expect(res.executionOptimistic).toBe(false);
      expect(getHeadState).not.toHaveBeenCalled();
    });

    it("falls back to the closest head state if the head block's post-state is not cached (anchor at skipped boundary slot)", async () => {
      const {chain, getHeadState} = getChain(null);
      const res = await getStateResponseWithRegen(chain, sync, "head");
      expect(res.state).toBe(anchorState);
      expect(res.finalized).toBe(true);
      expect(getHeadState).toHaveBeenCalledOnce();
    });
  });
});
