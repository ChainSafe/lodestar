import {Mock, describe, expect, it, vi} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView, IBeaconStateViewGloas} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {resolveStateId} from "../../../../../../src/api/impl/beacon/state/utils.js";
import {NodeIsSyncing} from "../../../../../../src/api/impl/errors.js";
import {getBuilderIndexByPubkey, getStateBuilderIndex} from "../../../../../../src/chain/beaconEngine/beaconApis.js";
import {BeaconEngineCore} from "../../../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {getStateValidatorIndex} from "../../../../../../src/chain/beaconEngine/index.js";
import {IChainView} from "../../../../../../src/chain/chainView/interface.js";
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

  describe("getStateBuilderIndex", () => {
    const builders = Array.from({length: 4}, (_, i) => ({
      ...ssz.gloas.Builder.defaultValue(),
      pubkey: new Uint8Array(48).fill(i + 1),
    }));
    const getBuilder = vi.fn((index: number) => builders[index]);
    const state = {getBuilder, getBuildersLength: () => builders.length} as unknown as IBeaconStateViewGloas;

    it("should resolve builder indices and pubkeys", () => {
      const getBuilderIndexByPubkeyMap = () => getBuilderIndexByPubkey(state);
      expect(getStateBuilderIndex("2", state, getBuilderIndexByPubkeyMap)).toEqual({valid: true, builderIndex: 2});
      expect(getStateBuilderIndex(toHexString(builders[3].pubkey), state, getBuilderIndexByPubkeyMap)).toEqual({
        valid: true,
        builderIndex: 3,
      });
      expect(getStateBuilderIndex(builders[0].pubkey, state, getBuilderIndexByPubkeyMap)).toEqual({
        valid: true,
        builderIndex: 0,
      });
    });

    it("should return valid: false on builder indices / pubkeys not in the state", () => {
      const getBuilderIndexByPubkeyMap = () => getBuilderIndexByPubkey(state);
      expect(getStateBuilderIndex(String(builders.length), state, getBuilderIndexByPubkeyMap).valid).toBe(false);
      expect(getStateBuilderIndex(new Uint8Array(48).fill(9), state, getBuilderIndexByPubkeyMap).valid).toBe(false);
      expect(getStateBuilderIndex("0xfoo", state, getBuilderIndexByPubkeyMap).valid).toBe(false);
    });

    it("should read each builder once to resolve many pubkeys", () => {
      getBuilder.mockClear();
      const builderIndexByPubkey = getBuilderIndexByPubkey(state);
      for (const [i, builder] of builders.entries()) {
        expect(
          getStateBuilderIndex(builder.pubkey, state, () => builderIndexByPubkey),
          `builder ${i}`
        ).toEqual({valid: true, builderIndex: i});
      }
      expect(getBuilder).toHaveBeenCalledTimes(builders.length);
    });
  });

  describe("resolveStateId while syncing", () => {
    const chainView = {
      getHead: () => ({slot: 0}),
      getFinalizedCheckpoint: () => ({epoch: 0, rootHex: "0xbb"}),
      getJustifiedCheckpoint: () => ({epoch: 0, rootHex: "0xbb"}),
    } as unknown as IChainView;
    const chain = {beaconEngine: {chainView}, clock: {currentSlot: 10 * SLOTS_PER_EPOCH}} as unknown as IBeaconChain;
    const sync = {state: SyncState.SyncingFinalized} as unknown as IBeaconSync;
    it("rejects a regen-triggering slot while behind and syncing", () => {
      expect(() => resolveStateId(chainView, 5 * SLOTS_PER_EPOCH, chain, sync)).toThrow(NodeIsSyncing);
    });
    it("allows head/finalized/justified/genesis while syncing", () => {
      for (const stateId of ["head", "finalized", "justified", "genesis"] as const) {
        expect(resolveStateId(chainView, stateId, chain, sync), stateId).toBeDefined();
      }
    });
  });

  describe("getStateResponseWithRegen head", () => {
    const head = {slot: 15902, stateRoot: "0xaa", executionStatus: ExecutionStatus.Valid};
    const headBytes = new Uint8Array([1]);
    const headPostState = {epoch: 496, slot: 15902, serialize: () => headBytes};
    // Anchor state at the epoch boundary after the head block, slots 15903-15904 skipped
    const anchorBytes = new Uint8Array([2]);
    const anchorState = {epoch: 497, slot: 15904, serialize: () => anchorBytes};
    const sync = {state: SyncState.Synced} as unknown as IBeaconSync;

    function getChain(cachedState: unknown): {chain: IBeaconChain; getHeadState: Mock} {
      const getHeadState = vi.fn(() => anchorState);
      const engine = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
        forkChoice: {
          getHead: () => head,
          getFinalizedCheckpoint: () => ({rootHex: "0xbb", epoch: 497}),
        },
        regen: {getStateSync: (stateRoot: string) => (stateRoot === head.stateRoot ? cachedState : null)},
        getHeadState,
      });
      const chain = {beaconEngine: engine} as unknown as IBeaconChain;
      return {chain, getHeadState};
    }

    it("serves the head block's post-state from the block state cache", async () => {
      const {chain, getHeadState} = getChain(headPostState);
      const res = await chain.beaconEngine.getSerializedState(
        resolveStateId(chain.beaconEngine.chainView, "head", chain, sync)
      );
      expect(res?.state).toBe(headBytes);
      expect(res?.finalized).toBe(true);
      expect(res?.executionOptimistic).toBe(false);
      expect(getHeadState).not.toHaveBeenCalled();
    });

    it("falls back to the closest head state if the head block's post-state is not cached (anchor at skipped boundary slot)", async () => {
      const {chain, getHeadState} = getChain(null);
      const res = await chain.beaconEngine.getSerializedState(
        resolveStateId(chain.beaconEngine.chainView, "head", chain, sync)
      );
      expect(res?.state).toBe(anchorBytes);
      expect(res?.finalized).toBe(true);
      expect(getHeadState).toHaveBeenCalledOnce();
    });
  });
});
