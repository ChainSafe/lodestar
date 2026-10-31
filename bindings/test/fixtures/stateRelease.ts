import assert from "node:assert/strict";
import {ssz} from "@lodestar/types";
import bindings, {type BeaconConfig, type BeaconStateView} from "../../src/index.js";
import {pubkeyCache} from "../../src/pubkeys.js";
import {createStfState, stfConfig} from "../stfFixture.js";

const value = createStfState();
const bytes = ssz.fulu.BeaconState.serialize(value);
pubkeyCache.ensureCapacity(value.validators.length);

const releaseCallbacks = {
  "Map construction and set callbacks": (state: BeaconStateView): void => {
    const NATIVE_MAP = Map;
    globalThis.Map = class<K, V> extends NATIVE_MAP<K, V> {
      constructor(entries?: Iterable<readonly [K, V]> | null) {
        super(entries);
        state.release();
      }
      set(key: K, value: V) {
        state.release();
        return super.set(key, value);
      }
    };
    let committee;
    try {
      committee = state.currentSyncCommitteeIndexed;
    } finally {
      globalThis.Map = NATIVE_MAP;
    }
    assert.equal(committee.validatorIndices.length, 512);
    assert.deepEqual(
      committee.validatorIndexMap.get(0),
      Array.from({length: 512}, (_, i) => i)
    );
  },
  "Set membership callback": (state: BeaconStateView): void => {
    const epoch = state.epoch;
    const statuses = new Set<string>();
    statuses.has = () => {
      state.release();
      return true;
    };
    assert.equal(state.getValidatorsByStatus(statuses, epoch).length, value.validators.length);
  },
  "block rewards getter": (state: BeaconStateView): void => {
    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    block.message.slot = state.slot;
    const rewards = state.computeBlockRewards(ssz.fulu.SignedBeaconBlock.serialize(block), false, {
      get attestations() {
        state.release();
        return 1;
      },
      slashing: 0,
      syncAggregate: 2,
    });
    assert.equal(rewards.attestations, 1);
    assert.equal(rewards.syncAggregate, 2);
    assert.equal(rewards.total, 3);
  },
  "block rewards output setter": (state: BeaconStateView): void => {
    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    block.message.slot = state.slot;
    Object.defineProperty(Object.prototype, "total", {
      configurable: true,
      set(total: number) {
        state.release();
        Object.defineProperty(this, "total", {enumerable: true, value: total});
      },
    });
    let rewards;
    try {
      rewards = state.computeBlockRewards(ssz.fulu.SignedBeaconBlock.serialize(block), false);
    } finally {
      Reflect.deleteProperty(Object.prototype, "total");
    }
    assert.equal(rewards.total, 0);
  },
  "inherited output setter": (state: BeaconStateView): void => {
    Object.defineProperty(Object.prototype, "depositRoot", {
      configurable: true,
      set(root: Uint8Array) {
        state.release();
        Object.defineProperty(this, "depositRoot", {enumerable: true, value: root});
      },
    });
    let result;
    try {
      result = state.eth1Data;
    } finally {
      Reflect.deleteProperty(Object.prototype, "depositRoot");
    }
    assert.deepEqual(result.depositRoot, value.eth1Data.depositRoot);
    assert.equal(result.depositCount, BigInt(value.eth1Data.depositCount));
  },
  "nested output setter": (state: BeaconStateView): void => {
    let nested = false;
    Object.defineProperty(Object.prototype, "depositRoot", {
      configurable: true,
      set(root: Uint8Array) {
        if (nested) {
          state.release();
        } else {
          nested = true;
          assert.equal(state.eth1Data.depositCount, BigInt(value.eth1Data.depositCount));
        }
        Object.defineProperty(this, "depositRoot", {enumerable: true, value: root});
      },
    });
    let result;
    try {
      result = state.eth1Data;
    } finally {
      Reflect.deleteProperty(Object.prototype, "depositRoot");
    }
    assert.deepEqual(result.depositRoot, value.eth1Data.depositRoot);
    assert.equal(result.depositCount, BigInt(value.eth1Data.depositCount));
  },
  "slot options getter": (state: BeaconStateView): void => {
    const slot = state.slot;
    const descendant = state.processSlots(slot, {
      get dontTransferCache() {
        state.release();
        assert.throws(() => state.slot, {code: "InvalidState"});
        return true;
      },
    });
    assert.equal(descendant.slot, slot);
    assert.deepEqual(descendant.hashTreeRoot(), ssz.fulu.BeaconState.hashTreeRoot(value));
    descendant.release();
  },
  "throwing options getter": (state: BeaconStateView): void => {
    const slot = state.slot;
    assert.throws(
      () =>
        state.processSlots(slot, {
          get dontTransferCache(): never {
            state.release();
            throw new Error("options failed");
          },
        }),
      {message: "options failed"}
    );
  },
  "transition options getter": (state: BeaconStateView): void => {
    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    block.message.slot = state.slot + 1;
    block.message.proposerIndex = state.getBeaconProposer(block.message.slot);
    assert.throws(
      () =>
        state.stateTransition(ssz.fulu.SignedBeaconBlock.serialize(block), false, {
          verifyProposer: false,
          verifySignatures: false,
          get verifyStateRoot() {
            state.release();
            return false;
          },
        }),
      {code: "BlockParentRootMismatch"}
    );
  },
};

export type ReleaseScenario = "retained wrappers" | "retained descendants" | keyof typeof releaseCallbacks;

switch (process.argv[2]) {
  case "retained wrappers": {
    assert.equal(typeof global.gc, "undefined");
    const config = new bindings.BeaconConfig(stfConfig, new Uint8Array(32));
    const retained = [];
    const expectedRoot = ssz.fulu.BeaconState.hashTreeRoot(value);
    for (let i = 0; i < 100; i++) {
      const state = bindings.BeaconStateView.createFromBytes(bytes, config);
      const clone = state.processSlots(state.slot);
      state.release();
      assert.throws(() => state.slot, {code: "InvalidState"}, `released state ${i}`);
      assert.deepEqual(clone.hashTreeRoot(), expectedRoot, `retained clone ${i}`);
      clone.release();
      state.release();
      clone.release();
      assert.throws(() => clone.hashTreeRoot(), {code: "InvalidState"}, `released clone ${i}`);
      retained.push(state, clone);
    }
    assert.equal(retained.length, 200);
    break;
  }
  case "retained descendants": {
    let config: BeaconConfig | undefined = new bindings.BeaconConfig(stfConfig, new Uint8Array(32));
    let state: BeaconStateView | undefined = bindings.BeaconStateView.createFromBytes(bytes, config);
    const descendant = state.processSlots(state.slot);
    const expectedRoot = descendant.hashTreeRoot();
    config = undefined;
    state.release();
    state = undefined;
    assert(global.gc);
    global.gc();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(descendant.hashTreeRoot(), expectedRoot);
    const advanced = descendant.processSlots(descendant.slot + 1);
    descendant.release();
    descendant.release();
    assert.equal(advanced.slot, value.slot + 1);
    Object.assign(globalThis, {retainedAtExit: {advanced, descendant}});
    break;
  }
  default: {
    const scenario = process.argv[2];
    assert(scenario && Object.hasOwn(releaseCallbacks, scenario), `Unknown release scenario: ${scenario}`);
    const state = bindings.BeaconStateView.createFromBytes(
      bytes,
      new bindings.BeaconConfig(stfConfig, new Uint8Array(32))
    );
    releaseCallbacks[scenario as keyof typeof releaseCallbacks](state);
    assert.throws(() => state.slot, {code: "InvalidState"});
    state.release();
  }
}
console.log("completed");
