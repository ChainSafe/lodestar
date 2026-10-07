import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {
  BUILDER_INDEX_SELF_BUILD,
  EPOCHS_PER_ETH1_VOTING_PERIOD,
  ForkName,
  ForkSeq,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {DataAvailabilityStatus, ExecutionPayloadStatus} from "../../../src/block/externalData.js";
import {processBlock, processOperations} from "../../../src/block/index.js";
import {processDepositRequest} from "../../../src/block/processDepositRequest.js";
import {G2_POINT_AT_INFINITY} from "../../../src/constants/index.js";
import {upgradeStateToHeze} from "../../../src/slot/upgradeStateToHeze.js";
import {processSlots} from "../../../src/stateTransition.js";
import {BeaconStateView} from "../../../src/stateView/beaconStateView.js";
import {createCachedBeaconStateTest} from "../../../src/testUtils/state.js";
import {getPubkeys} from "../../../src/testUtils/util.js";
import {CachedBeaconStateHeze} from "../../../src/types.js";
import {
  applyDeposits,
  applyEth1BlockHash,
  getGenesisBeaconState,
  initializeBeaconStateFromEth1,
} from "../../../src/util/genesis.js";
import {loadState, loadStateAndValidators} from "../../../src/util/loadState/loadState.js";
import {getValidatorCountFromStateBytes, getValidatorPubkeyFromStateBytes} from "../../../src/util/sszBytes.js";

const config = createBeaconConfig(getConfig(ForkName.heze, 1), new Uint8Array(32));

function buildGloasState(slot = SLOTS_PER_EPOCH) {
  const state = ssz.gloas.BeaconState.defaultViewDU();
  state.slot = slot;
  state.fork.currentVersion = config.GLOAS_FORK_VERSION;
  state.eth1DepositIndex = 7;
  state.depositRequestsStartIndex = 7n;
  state.eth1Data.depositCount = 7n;
  state.eth1DataVotes.push(ssz.phase0.Eth1Data.toViewDU(ssz.phase0.Eth1Data.defaultValue()));
  const {pubkeys} = getPubkeys(64);
  for (const pubkey of pubkeys) {
    const validator = ssz.phase0.Validator.defaultViewDU();
    validator.pubkey = pubkey;
    validator.effectiveBalance = 32e9;
    validator.activationEligibilityEpoch = 0;
    validator.activationEpoch = 0;
    validator.exitEpoch = Infinity;
    validator.withdrawableEpoch = Infinity;
    state.validators.push(validator);
    state.balances.push(32e9);
    state.previousEpochParticipation.push(0);
    state.currentEpochParticipation.push(0);
    state.inactivityScores.push(0);
  }
  const committee = ssz.altair.SyncCommittee.toViewDU({
    pubkeys: Array.from({length: ssz.altair.SyncCommittee.fields.pubkeys.length}, () => pubkeys[0]),
    aggregatePubkey: pubkeys[0],
  });
  state.currentSyncCommittee = committee;
  state.nextSyncCommittee = committee;
  state.commit();
  return createCachedBeaconStateTest(state, config);
}

function buildHezeState(slot = SLOTS_PER_EPOCH): CachedBeaconStateHeze {
  return upgradeStateToHeze(buildGloasState(slot));
}

describe("Heze EIP-8015 transition", () => {
  it("preserves every surviving state field and initializes the Heze bid", () => {
    const pre = buildGloasState();
    const before = pre.toValue();
    const post = upgradeStateToHeze(pre);
    const {
      eth1Data: _eth1Data,
      eth1DataVotes: _eth1DataVotes,
      eth1DepositIndex: _eth1DepositIndex,
      depositRequestsStartIndex: _depositRequestsStartIndex,
      ...preservedFields
    } = before;
    const expected = {
      ...preservedFields,
      fork: {
        previousVersion: config.GLOAS_FORK_VERSION,
        currentVersion: config.HEZE_FORK_VERSION,
        epoch: 1,
      },
      latestExecutionPayloadBid: {
        ...before.latestExecutionPayloadBid,
        inclusionListBits: ssz.heze.InclusionListBits.defaultValue(),
      },
    };
    expect(post.toValue()).toEqual(expected);
    expect(post.epochCtx).toBe(pre.epochCtx);
    expect(post.toValue()).not.toHaveProperty("eth1Data");
    expect(post.toValue()).not.toHaveProperty("depositRequestsStartIndex");
    expect(pre.toValue()).toEqual(before);
  });

  for (const startIndex of [6n, 8n, 18446744073709551615n]) {
    it(`rejects an incomplete legacy deposit transition with start index ${startIndex}`, () => {
      const pre = buildGloasState();
      pre.depositRequestsStartIndex = startIndex;
      const before = pre.serialize();
      expect(() => upgradeStateToHeze(pre)).toThrow("legacy deposit mechanism is disabled");
      expect(pre.serialize()).toEqual(before);
    });
  }

  it("processes a Heze block without legacy Eth1 data or deposits", () => {
    const state = buildHezeState(SLOTS_PER_EPOCH + 1);
    const block = ssz.heze.BeaconBlock.defaultValue();
    block.slot = state.slot;
    block.proposerIndex = state.epochCtx.getBeaconProposer(state.slot);
    block.parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader);
    const bid = block.body.signedExecutionPayloadBid;
    bid.signature = G2_POINT_AT_INFINITY;
    bid.message.builderIndex = BUILDER_INDEX_SELF_BUILD;
    bid.message.slot = state.slot;
    bid.message.blockHash.fill(1);
    bid.message.parentBlockRoot = state.blockRoots.get((state.slot - 1) % state.blockRoots.length);
    bid.message.prevRandao = state.randaoMixes.get(state.epochCtx.epoch % state.randaoMixes.length);
    state.latestExecutionPayloadBid.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(
      block.body.parentExecutionRequests
    );
    processBlock(
      ForkSeq.heze,
      state,
      block,
      {executionPayloadStatus: ExecutionPayloadStatus.valid, dataAvailabilityStatus: DataAvailabilityStatus.Available},
      {verifySignatures: false}
    );
    expect(state.latestBlockHeader.slot).toBe(block.slot);
    expect(state.latestExecutionPayloadBid.blockHash).toEqual(bid.message.blockHash);
    expect(state.toValue()).not.toHaveProperty("eth1DataVotes");
  });

  it("retains Gloas empty legacy-deposit validation", () => {
    const state = buildGloasState();
    const body = ssz.gloas.BeaconBlockBody.defaultValue();
    body.deposits.push(ssz.phase0.Deposit.defaultValue());
    expect(() => processOperations(ForkSeq.gloas, state, body, 0)).toThrow("incorrect number of deposits");
  });

  it("queues Heze deposit requests without recreating a start index", () => {
    const state = buildHezeState();
    const request = ssz.electra.DepositRequest.defaultValue();
    request.index = 123n;
    processDepositRequest(ForkSeq.heze, state, request);
    expect(state.pendingDeposits.length).toBe(1);
    expect(state.pendingDeposits.getReadonly(0).slot).toBe(state.slot);
    expect(Object.hasOwn(state, "depositRequestsStartIndex")).toBe(false);
  });

  it("processes an Eth1 voting-period epoch boundary without resetting removed votes", () => {
    const slot = EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH - 1;
    const state = buildHezeState(slot);
    const request = ssz.electra.DepositRequest.defaultValue();
    request.pubkey = state.validators.getReadonly(0).pubkey;
    request.amount = 1e9;
    processDepositRequest(ForkSeq.heze, state, request);
    state.pendingDeposits.get(0).slot = SLOTS_PER_EPOCH;
    state.finalizedCheckpoint.epoch = state.epochCtx.epoch;
    const post = processSlots(state, slot + 1) as CachedBeaconStateHeze;
    expect(post.slot).toBe(slot + 1);
    expect(post.pendingDeposits.length).toBe(0);
    expect(post.toValue()).not.toHaveProperty("eth1DataVotes");
    expect(post.toValue()).not.toHaveProperty("eth1DepositIndex");
  });

  it("loads Heze state and validator bytes using the compact serialized field order", () => {
    const seed = buildGloasState();
    const state = upgradeStateToHeze(seed);
    state.validators.get(0).effectiveBalance = 31e9;
    state.inactivityScores.set(0, 5);
    const bytes = state.serialize();
    const loaded = loadStateAndValidators(config, bytes);
    expect(loaded.state.hashTreeRoot()).toEqual(state.hashTreeRoot());
    expect(loaded.validatorsBytes).toEqual(state.validators.serialize());
    const migrated = loadState(config, seed, bytes);
    expect(migrated.state.hashTreeRoot()).toEqual(state.hashTreeRoot());
    expect(migrated.modifiedValidators).toEqual([0]);
    expect(getValidatorCountFromStateBytes(config, bytes)).toBe(64);
    expect(getValidatorPubkeyFromStateBytes(config, bytes, 0)).toEqual(state.validators.getReadonly(0).pubkey);
  });

  it("exposes no legacy Eth1 data through the Heze state-view contract", () => {
    const pre = buildGloasState(SLOTS_PER_EPOCH - 1);
    expect(new BeaconStateView(pre).eth1Data).toEqual(pre.eth1Data);
    expect(() => new BeaconStateView(buildHezeState()).eth1Data).toThrow("eth1Data is not available after Heze");
  });

  it("keeps Heze genesis entropy without inventing legacy fields", () => {
    const hezeConfig = createBeaconConfig(getConfig(ForkName.heze), new Uint8Array(32));
    const eth1Data = ssz.phase0.Eth1Data.defaultValue();
    eth1Data.blockHash.fill(3);
    const state = getGenesisBeaconState(hezeConfig, eth1Data, ssz.phase0.BeaconBlockHeader.defaultValue());
    expect(state.randaoMixes.get(0)).toEqual(eth1Data.blockHash);
    expect(Object.hasOwn(state, "eth1Data")).toBe(false);
    const cached = createCachedBeaconStateTest(state, hezeConfig, {
      skipSyncCommitteeCache: true,
      skipSyncPubkeys: true,
    });
    const blockHash = new Uint8Array(32).fill(4);
    applyEth1BlockHash(cached, blockHash);
    expect(cached.randaoMixes.get(0)).toEqual(blockHash);
    expect(Object.hasOwn(cached, "eth1Data")).toBe(false);
    expect(() => applyDeposits(hezeConfig, cached, [])).toThrow("Legacy Eth1 genesis deposits");
    expect(() =>
      initializeBeaconStateFromEth1(hezeConfig, {config: hezeConfig, pubkeyCache}, blockHash, 0, [])
    ).toThrow("Legacy Eth1 genesis deposits");
  });
});
