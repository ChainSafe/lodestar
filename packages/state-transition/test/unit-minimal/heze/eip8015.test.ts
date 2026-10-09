import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {Tree, toGindex} from "@chainsafe/persistent-merkle-tree";
import {BitArray} from "@chainsafe/ssz";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {
  BUILDER_INDEX_SELF_BUILD,
  DEPOSIT_CONTRACT_TREE_DEPTH,
  DOMAIN_DEPOSIT,
  EPOCHS_PER_ETH1_VOTING_PERIOD,
  ForkName,
  ForkSeq,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
  UNSET_DEPOSIT_REQUESTS_START_INDEX,
} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {DataAvailabilityStatus, ExecutionPayloadStatus} from "../../../src/block/externalData.js";
import {processBlock, processOperations} from "../../../src/block/index.js";
import {processDepositRequest} from "../../../src/block/processDepositRequest.js";
import {G2_POINT_AT_INFINITY, ZERO_HASH} from "../../../src/constants/index.js";
import {upgradeStateToHeze} from "../../../src/slot/upgradeStateToHeze.js";
import {processSlots} from "../../../src/stateTransition.js";
import {BeaconStateView} from "../../../src/stateView/beaconStateView.js";
import {createCachedBeaconStateTest} from "../../../src/testUtils/state.js";
import {getPubkeys} from "../../../src/testUtils/util.js";
import {CachedBeaconStateGloas, CachedBeaconStateHeze} from "../../../src/types.js";
import {applyDeposits, getGenesisBeaconState, initializeBeaconStateFromEth1} from "../../../src/util/genesis.js";
import {computeDomain, computeSigningRoot} from "../../../src/util/index.js";
import {interopSecretKey} from "../../../src/util/interop.js";
import {loadState, loadStateAndValidators} from "../../../src/util/loadState/loadState.js";
import {
  VALIDATOR_BYTES_SIZE,
  getValidatorCountFromStateBytes,
  getValidatorPubkeyFromStateBytes,
} from "../../../src/util/sszBytes.js";

const config = getConfig(ForkName.heze, 1);
const VALIDATOR_COUNT = 64;

/** Deposit data with a valid proof-of-possession for interop key `index` and 0x01 credentials. */
function buildDepositData(index: number): phase0.DepositData {
  const secretKey = interopSecretKey(index);
  const pubkey = secretKey.toPublicKey().toBytes();
  const withdrawalCredentials = new Uint8Array(32).fill(index + 1);
  withdrawalCredentials[0] = 0x01;
  const depositMessage = {pubkey, withdrawalCredentials, amount: 32e9};
  const domain = computeDomain(DOMAIN_DEPOSIT, config.GENESIS_FORK_VERSION, ZERO_HASH);
  const signingRoot = computeSigningRoot(ssz.phase0.DepositMessage, depositMessage, domain);
  return {...depositMessage, signature: secretKey.sign(signingRoot).toBytes()};
}

/**
 * Gloas state one epoch before the Heze fork with non-default values in every field group the upgrade
 * must copy (history, finality, registry, withdrawals, deposits queue, builders, payload), so a forgotten
 * copy cannot hide behind a default.
 */
function buildGloasState(slot = SLOTS_PER_EPOCH) {
  const state = ssz.gloas.BeaconState.defaultViewDU();
  const {pubkeys} = getPubkeys(VALIDATOR_COUNT);
  state.genesisTime = 1_700_000_000;
  state.slot = slot;
  state.fork.currentVersion = config.GLOAS_FORK_VERSION;
  state.latestBlockHeader.slot = slot - 1;
  state.latestBlockHeader.parentRoot = Buffer.alloc(32, 0x11);
  state.blockRoots.set(0, Buffer.alloc(32, 0x12));
  state.stateRoots.set(0, Buffer.alloc(32, 0x13));
  state.eth1DepositIndex = 7;
  state.depositRequestsStartIndex = 7n;
  state.eth1Data.depositCount = 7n;
  state.eth1DataVotes.push(ssz.phase0.Eth1Data.toViewDU(ssz.phase0.Eth1Data.defaultValue()));
  for (const [i, pubkey] of pubkeys.entries()) {
    const validator = ssz.phase0.Validator.defaultViewDU();
    validator.pubkey = pubkey;
    const withdrawalCredentials = Buffer.alloc(32, 0);
    withdrawalCredentials[0] = 0x01;
    withdrawalCredentials[31] = i;
    validator.withdrawalCredentials = withdrawalCredentials;
    validator.effectiveBalance = 32e9;
    validator.activationEligibilityEpoch = 0;
    validator.activationEpoch = 0;
    validator.exitEpoch = Infinity;
    validator.withdrawableEpoch = Infinity;
    state.validators.push(validator);
    state.balances.push(32e9 + i);
    state.previousEpochParticipation.push(i % 8);
    state.currentEpochParticipation.push((i + 3) % 8);
    state.inactivityScores.push(i % 5);
  }
  state.randaoMixes.set(0, Buffer.alloc(32, 0x14));
  state.slashings.set(0, 1_000_000_000);
  state.justificationBits = ssz.phase0.JustificationBits.toViewDU(BitArray.fromBoolArray([true, false, true, false]));
  state.finalizedCheckpoint.root = Buffer.alloc(32, 0x15);
  const committee = ssz.altair.SyncCommittee.toViewDU({
    pubkeys: Array.from({length: ssz.altair.SyncCommittee.fields.pubkeys.length}, () => pubkeys[0]),
    aggregatePubkey: pubkeys[0],
  });
  state.currentSyncCommittee = committee;
  state.nextSyncCommittee = committee;
  state.latestBlockHash = Buffer.alloc(32, 0x16);
  state.nextWithdrawalIndex = 5;
  state.nextWithdrawalValidatorIndex = 3;
  state.historicalSummaries.push(
    ssz.capella.HistoricalSummary.toViewDU({
      blockSummaryRoot: Buffer.alloc(32, 0x17),
      stateSummaryRoot: Buffer.alloc(32, 0x18),
    })
  );
  state.depositBalanceToConsume = 9n;
  state.exitBalanceToConsume = 8n;
  state.earliestExitEpoch = 2;
  state.consolidationBalanceToConsume = 7n;
  state.earliestConsolidationEpoch = 3;
  state.pendingPartialWithdrawals.push(
    ssz.electra.PendingPartialWithdrawal.toViewDU({validatorIndex: 1, amount: 2_000_000_000n, withdrawableEpoch: 4})
  );
  state.pendingConsolidations.push(ssz.electra.PendingConsolidation.toViewDU({sourceIndex: 1, targetIndex: 2}));
  state.proposerLookahead.set(0, 7);
  for (const builderPubkey of [pubkeys[0], pubkeys[1]]) {
    state.builders.push(
      ssz.gloas.Builder.toViewDU({
        pubkey: builderPubkey,
        version: 1,
        executionAddress: Buffer.alloc(20, 0x19),
        balance: 1e9,
        depositEpoch: 0,
        withdrawableEpoch: Infinity,
      })
    );
  }
  state.nextWithdrawalBuilderIndex = 1;
  state.executionPayloadAvailability = ssz.gloas.BeaconState.fields.executionPayloadAvailability.toViewDU(
    BitArray.fromBoolArray(Array.from({length: SLOTS_PER_HISTORICAL_ROOT}, (_, i) => i === 3))
  );
  state.builderPendingWithdrawals.push(
    ssz.gloas.BuilderPendingWithdrawal.toViewDU({feeRecipient: Buffer.alloc(20, 0x1a), amount: 3e9, builderIndex: 0})
  );
  state.latestExecutionPayloadBid.blockHash = Buffer.alloc(32, 0x1b);
  state.latestExecutionPayloadBid.gasLimit = 30_000_000n;
  state.payloadExpectedWithdrawals.push(
    ssz.capella.Withdrawal.toViewDU({
      index: 1,
      validatorIndex: 2,
      address: Buffer.alloc(20, 0x1c),
      amount: 4_000_000_000n,
    })
  );
  state.commit();
  return createCachedBeaconStateTest(state, config);
}

function buildHezeState(slot = SLOTS_PER_EPOCH): CachedBeaconStateHeze {
  return upgradeStateToHeze(buildGloasState(slot));
}

/** Heze block at `state.slot` that self-builds on a FULL parent, so parent execution requests are applied. */
function buildHezeBlock(
  state: CachedBeaconStateHeze,
  parentExecutionRequests = ssz.gloas.ExecutionRequests.defaultValue()
) {
  const block = ssz.heze.BeaconBlock.defaultValue();
  block.slot = state.slot;
  block.proposerIndex = state.epochCtx.getBeaconProposer(state.slot);
  block.parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader);
  block.body.parentExecutionRequests = parentExecutionRequests;
  const bid = block.body.signedExecutionPayloadBid;
  bid.signature = G2_POINT_AT_INFINITY;
  bid.message.builderIndex = BUILDER_INDEX_SELF_BUILD;
  bid.message.slot = state.slot;
  bid.message.parentBlockHash = state.latestExecutionPayloadBid.blockHash;
  bid.message.blockHash.fill(1);
  bid.message.parentBlockRoot = state.blockRoots.get((state.slot - 1) % state.blockRoots.length);
  bid.message.prevRandao = state.randaoMixes.get(state.epochCtx.epoch % state.randaoMixes.length);
  state.latestExecutionPayloadBid.executionRequestsRoot =
    ssz.gloas.ExecutionRequests.hashTreeRoot(parentExecutionRequests);
  return block;
}

const externalData = {
  executionPayloadStatus: ExecutionPayloadStatus.valid,
  dataAvailabilityStatus: DataAvailabilityStatus.Available,
};

describe("Heze EIP-8015 state transition", () => {
  it("upgradeStateToHeze drops the legacy fields and keeps every other field", () => {
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
    expect(post.toValue()).toEqual({
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
    });
    for (const field of ["eth1Data", "eth1DataVotes", "eth1DepositIndex", "depositRequestsStartIndex"]) {
      expect(Object.hasOwn(ssz.heze.BeaconState.fields, field), field).toBe(false);
      expect(post.toValue()).not.toHaveProperty(field);
    }
  });

  for (const startIndex of [6n, 8n, UNSET_DEPOSIT_REQUESTS_START_INDEX]) {
    it(`upgradeStateToHeze rejects a pending legacy deposit transition (start index ${startIndex})`, () => {
      const pre = buildGloasState();
      pre.depositRequestsStartIndex = startIndex;
      expect(() => upgradeStateToHeze(pre)).toThrow("legacy deposit mechanism");
    });
  }

  it("processBlock accepts a Heze block without eth1Data or deposits", () => {
    const state = buildHezeState(SLOTS_PER_EPOCH + 1);
    const block = buildHezeBlock(state);
    processBlock(ForkSeq.heze, state, block, externalData, {verifySignatures: false});
    expect(state.latestBlockHeader.slot).toBe(block.slot);
    expect(state.latestExecutionPayloadBid.blockHash).toEqual(block.body.signedExecutionPayloadBid.message.blockHash);
  });

  it("processBlock queues a deposit request carried by the parent payload", () => {
    const state = buildHezeState(SLOTS_PER_EPOCH + 1);
    const requests = ssz.gloas.ExecutionRequests.defaultValue();
    requests.deposits.push({...buildDepositData(VALIDATOR_COUNT), index: 0n});
    const block = buildHezeBlock(state, requests);
    processBlock(ForkSeq.heze, state, block, externalData, {verifySignatures: false});
    expect(state.pendingDeposits.length).toBe(1);
    expect(state.pendingDeposits.getReadonly(0).slot).toBe(block.slot);
    expect(state.pendingDeposits.getReadonly(0).pubkey).toEqual(requests.deposits[0].pubkey);
  });

  it("processOperations still rejects Gloas blocks carrying deposits", () => {
    const state = buildGloasState(SLOTS_PER_EPOCH - 1);
    const body = ssz.gloas.BeaconBlockBody.defaultValue();
    body.deposits.push(ssz.phase0.Deposit.defaultValue());
    expect(() => processOperations(ForkSeq.gloas, state, body, 0)).toThrow("incorrect number of deposits");
  });

  it("processEpoch tops up an existing validator across the Eth1 voting period boundary", () => {
    const slot = EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH - 1;
    // Two identical states; only the deposit request separates them, so epoch rewards cancel out
    const control = buildHezeState(slot);
    const state = buildHezeState(slot);
    control.finalizedCheckpoint.epoch = control.epochCtx.epoch;
    state.finalizedCheckpoint.epoch = state.epochCtx.epoch;
    const request = ssz.electra.DepositRequest.defaultValue();
    request.pubkey = state.validators.getReadonly(0).pubkey;
    request.amount = 1e9;
    processDepositRequest(ForkSeq.heze, state, request);
    state.pendingDeposits.get(0).slot = SLOTS_PER_EPOCH;
    control.commit();
    state.commit();
    const postControl = processSlots(control, slot + 1) as CachedBeaconStateHeze;
    const post = processSlots(state, slot + 1) as CachedBeaconStateHeze;
    expect(post.slot).toBe(slot + 1);
    expect(post.pendingDeposits.length).toBe(0);
    expect(post.balances.get(0) - postControl.balances.get(0)).toBe(1e9);
    expect(post.toValue()).not.toHaveProperty("eth1DataVotes");
    expect(Object.hasOwn(post, "eth1DataVotes")).toBe(false);
  });

  it("processEpoch onboards a new validator from a Heze deposit request", () => {
    const slot = 2 * SLOTS_PER_EPOCH - 1;
    const state = buildHezeState(slot);
    const request = {...buildDepositData(VALIDATOR_COUNT), index: 0n};
    processDepositRequest(ForkSeq.heze, state, request);
    state.pendingDeposits.get(0).slot = SLOTS_PER_EPOCH;
    state.finalizedCheckpoint.epoch = state.epochCtx.epoch;
    state.commit();
    const post = processSlots(state, slot + 1) as CachedBeaconStateHeze;
    expect(post.validators.length).toBe(VALIDATOR_COUNT + 1);
    expect(post.validators.getReadonly(VALIDATOR_COUNT).pubkey).toEqual(request.pubkey);
    expect(post.balances.get(VALIDATOR_COUNT)).toBe(32e9);
    expect(post.pendingDeposits.length).toBe(0);
  });

  it("loadState and the state byte helpers follow the Heze field layout", () => {
    const seed = buildGloasState();
    const state = upgradeStateToHeze(seed);
    state.validators.get(0).effectiveBalance = 31e9;
    state.inactivityScores.set(0, 9);
    const bytes = state.serialize();

    expect(Object.keys(ssz.heze.BeaconState.fields).indexOf("validators")).toBe(8);
    expect(Object.keys(ssz.gloas.BeaconState.fields).indexOf("validators")).toBe(11);
    const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const validatorsRange = ssz.heze.BeaconState.getFieldRanges(dataView, 0, bytes.length)[8];
    expect(validatorsRange.start).toBe(ssz.heze.BeaconState.fixedEnd);
    expect(validatorsRange.end - validatorsRange.start).toBe(VALIDATOR_COUNT * VALIDATOR_BYTES_SIZE);

    const loaded = loadStateAndValidators(config, bytes);
    expect(loaded.state.hashTreeRoot()).toEqual(state.hashTreeRoot());
    expect(loaded.validatorsBytes).toEqual(state.validators.serialize());
    const migrated = loadState(config, seed, bytes);
    expect(migrated.state.hashTreeRoot()).toEqual(state.hashTreeRoot());
    expect(migrated.modifiedValidators).toEqual([0]);
    expect(getValidatorCountFromStateBytes(config, bytes)).toBe(VALIDATOR_COUNT);
    expect(getValidatorPubkeyFromStateBytes(config, bytes, 0)).toEqual(state.validators.getReadonly(0).pubkey);
  });

  it("BeaconStateView.eth1Data throws for Heze states", () => {
    const pre = buildGloasState(SLOTS_PER_EPOCH - 1);
    expect(new BeaconStateView(pre).eth1Data).toEqual(pre.eth1Data);
    expect(() => new BeaconStateView(buildHezeState()).eth1Data).toThrow("removed");
  });
});

describe("Heze EIP-8015 genesis", () => {
  const hezeConfig = getConfig(ForkName.heze);
  const beaconConfig = createBeaconConfig(hezeConfig, ZERO_HASH);

  function buildDeposit(index: number): phase0.Deposit {
    return {
      proof: Array.from({length: DEPOSIT_CONTRACT_TREE_DEPTH + 1}, () => ZERO_HASH),
      data: buildDepositData(index),
    };
  }

  function buildDepositsWithProofs(count: number): phase0.Deposit[] {
    const depositDataRootList = ssz.phase0.DepositDataRootList.defaultViewDU();
    const deposits: phase0.Deposit[] = [];
    for (let i = 0; i < count; i++) {
      const data = buildDepositData(i);
      depositDataRootList.push(ssz.phase0.DepositData.hashTreeRoot(data));
      depositDataRootList.commit();
      const proof = new Tree(depositDataRootList.node).getSingleProof(
        toGindex(depositDataRootList.type.depth, BigInt(i))
      );
      deposits.push({proof, data});
    }
    return deposits;
  }

  it("getGenesisBeaconState seeds randao without creating eth1Data", () => {
    const eth1Data = ssz.phase0.Eth1Data.defaultValue();
    eth1Data.blockHash.fill(3);
    const state = getGenesisBeaconState(hezeConfig, eth1Data, ssz.phase0.BeaconBlockHeader.defaultValue());
    expect(state.randaoMixes.get(0)).toEqual(eth1Data.blockHash);
    expect(Object.hasOwn(state, "eth1Data")).toBe(false);
    expect(Object.hasOwn(state.toValue(), "eth1Data")).toBe(false);
  });

  it("applyDeposits onboards validators without a deposit tree", () => {
    const state = createCachedBeaconStateTest(
      getGenesisBeaconState(
        hezeConfig,
        ssz.phase0.Eth1Data.defaultValue(),
        ssz.phase0.BeaconBlockHeader.defaultValue()
      ),
      hezeConfig,
      {skipSyncCommitteeCache: true, skipSyncPubkeys: true}
    ) as CachedBeaconStateHeze;
    const {activatedValidatorCount} = applyDeposits(hezeConfig, state, [buildDeposit(0), buildDeposit(1)]);
    expect(activatedValidatorCount).toBe(2);
    expect(state.validators.length).toBe(2);
    expect(state.balances.getAll()).toEqual([32e9, 32e9]);
    expect(state.pendingDeposits.length).toBe(0);
  });

  it("initializeBeaconStateFromEth1 builds a Heze genesis state", () => {
    const blockHash = new Uint8Array(32).fill(4);
    const state = initializeBeaconStateFromEth1(hezeConfig, {config: beaconConfig, pubkeyCache}, blockHash, 0, [
      buildDeposit(0),
    ]);
    expect(state.validators.length).toBe(1);
    expect(state.randaoMixes.get(0)).toEqual(blockHash);
    expect(state.fork.currentVersion).toEqual(hezeConfig.HEZE_FORK_VERSION);
    for (const field of ["eth1Data", "eth1DataVotes", "eth1DepositIndex", "depositRequestsStartIndex"]) {
      expect(Object.hasOwn(state, field), field).toBe(false);
      expect(Object.hasOwn(state.toValue(), field), field).toBe(false);
    }
  });

  it("initializeBeaconStateFromEth1 at a Gloas genesis closes the legacy deposit queue for the Heze upgrade", () => {
    const gloasConfig = getConfig(ForkName.gloas);
    const state = initializeBeaconStateFromEth1(
      gloasConfig,
      {config: createBeaconConfig(gloasConfig, ZERO_HASH), pubkeyCache},
      new Uint8Array(32).fill(5),
      0,
      buildDepositsWithProofs(2)
    ) as CachedBeaconStateGloas;
    expect(state.eth1DepositIndex).toBe(2);
    expect(state.depositRequestsStartIndex).toBe(2n);
    expect(() => upgradeStateToHeze(state)).not.toThrow();
  });
});
