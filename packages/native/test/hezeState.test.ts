import {ContainerType, ProgressiveContainerType} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {describe, expect, it} from "vitest";
import bindings from "../src/index.js";
import {pubkeyCache} from "../src/pubkeys.js";
import {createGloasState, gloasConfig} from "./gloasFixture.js";

// Lodestar fe4e7408b4's EIP-8015 layouts, not yet present in the pinned JS release.
const {
  eth1Data: _eth1Data,
  eth1DataVotes: _eth1DataVotes,
  eth1DepositIndex: _eth1DepositIndex,
  depositRequestsStartIndex: _depositRequestsStartIndex,
  ...stateFields
} = ssz.heze.BeaconState.fields;
const HEZE_STATE = new ProgressiveContainerType(
  stateFields,
  Array.from({length: 46}, (_, index) => ![8, 9, 10, 28].includes(index))
);
const {eth1Data: _bodyEth1Data, deposits: _deposits, ...bodyFields} = ssz.heze.BeaconBlockBody.fields;
const HEZE_BLOCK_BODY = new ProgressiveContainerType(
  bodyFields,
  Array.from({length: 13}, (_, index) => ![1, 6].includes(index))
);
const HEZE_BLOCK = new ContainerType({...ssz.heze.BeaconBlock.fields, body: HEZE_BLOCK_BODY});

function createNative() {
  const gloas = createGloasState();
  const value = {
    ...gloas,
    fork: {
      currentVersion: gloasConfig.HEZE_FORK_VERSION,
      epoch: 0,
      previousVersion: gloasConfig.GLOAS_FORK_VERSION,
    },
    latestExecutionPayloadBid: {
      ...gloas.latestExecutionPayloadBid,
      inclusionListBits: ssz.heze.ExecutionPayloadBid.defaultValue().inclusionListBits,
    },
  };
  value.latestExecutionPayloadBid.inclusionListBits.set(15, true);
  const bytes = HEZE_STATE.serialize(value);
  pubkeyCache.ensureCapacity(value.validators.length);
  const config = new bindings.BeaconConfig({...gloasConfig, HEZE_FORK_EPOCH: 0}, value.genesisValidatorsRoot);
  return {bytes, state: bindings.BeaconStateView.createFromBytes(bytes, config), value};
}

describe("Heze native state view", () => {
  it("preserves updated SSZ bytes, roots, bid bits and Gloas helpers", () => {
    const {value, bytes, state} = createNative();
    try {
      expect(state.forkName).toBe("heze");
      expect(state.forkSeq).toBe(8);
      expect(Buffer.compare(state.serialize(), bytes)).toBe(0);
      expect(state.hashTreeRoot()).toEqual(HEZE_STATE.hashTreeRoot(value));
      expect(Buffer.compare(HEZE_STATE.serialize(state.toValue()), bytes)).toBe(0);
      expect(state.latestExecutionPayloadBid).toEqual(value.latestExecutionPayloadBid);
      expect(state.latestBlockHash).toEqual(value.latestBlockHash);
      expect(state.getBuilder(0)).toEqual(value.builders[0]);
      expect(state.canBuilderCoverBid(0, 0)).toBe(true);
      expect(state.isMergeTransitionComplete).toBe(true);
      expect(state.isExecutionEnabled(HEZE_BLOCK.defaultValue())).toBe(true);
      expect(() => state.eth1Data).toThrow("InvalidAtFork");
      expect(state.getFinalizedRootProof()).toHaveLength(9);
      const slotsPerEpoch = value.builderPendingPayments.length / 2;
      expect(Array.from(state.getPayloadTimelinessCommittee(state.slot))).toEqual(
        value.ptcWindow[slotsPerEpoch + (state.slot % slotsPerEpoch)]
      );
      const cloned = state.processSlots(state.slot, {dontTransferCache: true});
      state.release();
      try {
        expect(cloned.hashTreeRoot()).toEqual(HEZE_STATE.hashTreeRoot(value));
      } finally {
        cloned.release();
      }
    } finally {
      state.release();
    }
  });

  it("selects inclusion list committees from the cached shuffling", () => {
    const {value, state} = createNative();
    try {
      const shuffling = state.getShufflingAtEpoch(state.epoch);
      const slotsPerEpoch = value.builderPendingPayments.length / 2;
      const members = shuffling.committees[state.slot % slotsPerEpoch].flatMap((committee) => Array.from(committee));
      const expected = Array.from({length: 16}, (_, index) => members[index % members.length] ?? 0);
      expect(Array.from(state.getInclusionListCommittee(state.slot))).toEqual(expected);
      expect(() => state.getInclusionListCommittee(-1)).toThrow("InvalidSlot");
      expect(() => state.getInclusionListCommittee(state.slot + 4 * slotsPerEpoch)).toThrow("ShufflingNotAvailable");
    } finally {
      state.release();
    }
  });

  it("applies parent payload requests without changing the source", () => {
    const {value, state} = createNative();
    try {
      const post = state.withParentPayloadApplied(
        ssz.gloas.ExecutionRequests.serialize(ssz.gloas.ExecutionRequests.defaultValue())
      );
      try {
        expect(post.forkName).toBe("heze");
        expect(post.latestBlockHash).toEqual(value.latestExecutionPayloadBid.blockHash);
        expect(state.hashTreeRoot()).toEqual(HEZE_STATE.hashTreeRoot(value));
      } finally {
        post.release();
      }
    } finally {
      state.release();
    }
  });
});
