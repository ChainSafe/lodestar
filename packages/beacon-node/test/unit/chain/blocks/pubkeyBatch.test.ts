import {createHash} from "node:crypto";
import {afterEach, describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {aggregateSignatures} from "@lodestar/native/blst";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {
  DEPOSIT_CONTRACT_TREE_DEPTH,
  DOMAIN_BEACON_PROPOSER,
  DOMAIN_DEPOSIT,
  DOMAIN_RANDAO,
  FAR_FUTURE_EPOCH,
  ForkName,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  G2_POINT_AT_INFINITY,
  ZERO_HASH,
  computeDomain,
  computeSigningRoot,
  computeTimeAtSlot,
  createBeaconStateView,
  createCachedBeaconState,
  getAttestationDataSigningRoot,
  getRandaoMix,
  interopSecretKey,
  processSlots,
  stateTransition,
} from "@lodestar/state-transition";
import {SignedBeaconBlock, electra, phase0, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {verifyBlocksInEpoch} from "../../../../src/chain/blocks/verifyBlock.js";
import {BlsSingleThreadVerifier} from "../../../../src/chain/bls/singleThread.js";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {BlockErrorCode} from "../../../../src/chain/errors/blockError.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {MockBlockInput} from "../../../utils/blockInput.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

const validatorCount = 64;
const epoch = 2;
const newKey = interopSecretKey(1000);
const otherKey = interopSecretKey(1001);

afterEach(() => pubkeyCache.reset());

describe.each([ForkName.phase0, ForkName.electra] as const)("pubkeys added within a %s block batch", (forkName) => {
  it.each([false, true])(
    "verifies a later slashing using the preceding post-state: disableBlsBatchVerify=%s",
    async (disableBlsBatchVerify) => {
      const {chain, blockInputs, preState} = createBatch(forkName);
      const result = await verifyBlocksInEpoch.call(
        chain,
        generateProtoBlock({slot: preState.slot - 1}),
        blockInputs,
        null,
        {
          skipVerifyExecutionPayload: true,
          verifyOnly: true,
          disableBlsBatchVerify,
        }
      );

      expect(result.postStates).toHaveLength(9);
      expect(preState.validatorCount).toBe(validatorCount);
      expect(result.postStates[8].validatorCount).toBe(validatorCount + 1);
      expect(result.postStates[8].getValidator(0).slashed).toBe(true);
      expect(pubkeyCache.size).toBe(validatorCount);
      expect(pubkeyCache.getIndex(newKey.toPublicKey().toBytes())).toBeNull();
    }
  );

  it("rejects signatures made by a conflicting global candidate", async () => {
    const {chain, blockInputs, preState} = createBatch(forkName, true);
    await expect(
      verifyBlocksInEpoch.call(chain, generateProtoBlock({slot: preState.slot - 1}), blockInputs, null, {
        skipVerifyExecutionPayload: true,
        verifyOnly: true,
      })
    ).rejects.toMatchObject({type: {code: BlockErrorCode.INVALID_SIGNATURE}});
    expect(pubkeyCache.size).toBe(validatorCount);
  });

  it("preserves the trusted-signatures option", async () => {
    const {chain, blockInputs, preState} = createBatch(forkName, true);
    const result = await verifyBlocksInEpoch.call(
      chain,
      generateProtoBlock({slot: preState.slot - 1}),
      blockInputs,
      null,
      {
        skipVerifyExecutionPayload: true,
        verifyOnly: true,
        validSignatures: true,
      }
    );
    expect(result.postStates).toHaveLength(9);
    expect(pubkeyCache.size).toBe(validatorCount);
  });

  it("rejects a slashing index absent from its actual pre-state", async () => {
    const {chain, blockInputs, preState} = createBatch(forkName);
    const slashing = blockInputs[8].getBlock().message.body.attesterSlashings[0];
    slashing.attestation1.attestingIndices[1]++;
    slashing.attestation2.attestingIndices[1]++;
    await expect(
      verifyBlocksInEpoch.call(chain, generateProtoBlock({slot: preState.slot - 1}), blockInputs, null, {
        skipVerifyExecutionPayload: true,
        verifyOnly: true,
      })
    ).rejects.toMatchObject({type: {code: BlockErrorCode.PER_BLOCK_PROCESSING_ERROR}});
  });
});

function createBatch(forkName: ForkName.phase0 | ForkName.electra, wrongKey = false) {
  pubkeyCache.reset();
  const genesisValidatorsRoot = Buffer.alloc(32, 0x61);
  const config = createBeaconConfig(getConfig(forkName, 0), genesisValidatorsRoot);
  const withdrawalCredentials = Buffer.alloc(32);
  withdrawalCredentials[0] = 1;
  const deposit = ssz.phase0.Deposit.defaultValue();
  deposit.data = {
    pubkey: newKey.toPublicKey().toBytes(),
    withdrawalCredentials,
    amount: 32e9,
    signature: newKey
      .sign(
        computeSigningRoot(
          ssz.phase0.DepositMessage,
          {pubkey: newKey.toPublicKey().toBytes(), withdrawalCredentials, amount: 32e9},
          computeDomain(DOMAIN_DEPOSIT, config.GENESIS_FORK_VERSION, ZERO_HASH)
        )
      )
      .toBytes(),
  };
  const hashPair = (a: Uint8Array, b: Uint8Array): Uint8Array => createHash("sha256").update(a).update(b).digest();
  let zero: Uint8Array = Buffer.alloc(32);
  let depositRoot = ssz.phase0.DepositData.hashTreeRoot(deposit.data);
  for (let i = 0; i < DEPOSIT_CONTRACT_TREE_DEPTH; i++) {
    deposit.proof[i] = zero;
    depositRoot = hashPair(depositRoot, zero);
    zero = hashPair(zero, zero);
  }
  const countRoot = Buffer.alloc(32);
  countRoot.writeBigUInt64LE(1n);
  deposit.proof[DEPOSIT_CONTRACT_TREE_DEPTH] = countRoot;
  depositRoot = hashPair(depositRoot, countRoot);

  const state = ssz[forkName].BeaconState.defaultViewDU();
  state.slot = epoch * SLOTS_PER_EPOCH;
  state.genesisValidatorsRoot = genesisValidatorsRoot;
  const version = config.forks[forkName].version;
  state.fork = ssz.phase0.Fork.toViewDU({previousVersion: version, currentVersion: version, epoch: 0});
  state.latestBlockHeader.slot = state.slot - 1;
  state.eth1Data = ssz.phase0.Eth1Data.toViewDU({depositRoot, depositCount: 1n, blockHash: Buffer.alloc(32, 0x21)});
  const pubkeys: Uint8Array[] = [];
  for (let i = 0; i < validatorCount; i++) {
    const pubkey = interopSecretKey(i).toPublicKey().toBytes();
    pubkeys.push(pubkey);
    state.validators.push(
      ssz.phase0.Validator.toViewDU({
        ...ssz.phase0.Validator.defaultValue(),
        pubkey,
        withdrawalCredentials,
        effectiveBalance: 32e9,
        activationEligibilityEpoch: 0,
        activationEpoch: 0,
        exitEpoch: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      })
    );
    state.balances.push(32e9);
    if ("inactivityScores" in state) {
      state.inactivityScores.push(0);
      state.previousEpochParticipation.push(0);
      state.currentEpochParticipation.push(0);
    }
  }
  if ("currentSyncCommittee" in state) {
    const committee = {
      pubkeys: Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => pubkeys[i % validatorCount]),
      aggregatePubkey: pubkeys[0],
    };
    state.currentSyncCommittee = ssz.altair.SyncCommittee.toViewDU(committee);
    state.nextSyncCommittee = ssz.altair.SyncCommittee.toViewDU(committee);
    state.depositRequestsStartIndex = 2n ** 64n - 1n;
  }
  const anchorBytes = state.serialize();
  let generation: CachedBeaconStateAllForks = createCachedBeaconState(state, {config, pubkeyCache});
  const blocks: SignedBeaconBlock[] = [];
  for (let i = 1; i <= 9; i++) {
    const slot = epoch * SLOTS_PER_EPOCH + i;
    const dialed = processSlots(generation, slot, {dontTransferCache: true});
    const block = ssz[forkName].SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    const proposerIndex = dialed.epochCtx.getBeaconProposer(slot);
    const proposerKey = interopSecretKey(proposerIndex);
    block.message.proposerIndex = proposerIndex;
    block.message.parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(dialed.latestBlockHeader);
    block.message.body.eth1Data = state.eth1Data.toValue();
    block.message.body.randaoReveal = proposerKey
      .sign(computeSigningRoot(ssz.Epoch, epoch, config.getDomain(slot, DOMAIN_RANDAO)))
      .toBytes();
    if (forkName === ForkName.electra && "latestExecutionPayloadHeader" in generation) {
      const body = block.message.body as electra.BeaconBlockBody;
      body.syncAggregate.syncCommitteeSignature = G2_POINT_AT_INFINITY;
      const payload = body.executionPayload;
      payload.timestamp = computeTimeAtSlot(config, slot, generation.genesisTime);
      payload.prevRandao = getRandaoMix(dialed, epoch);
      payload.parentHash = generation.latestExecutionPayloadHeader.blockHash;
      payload.blockHash = Buffer.alloc(32, i);
    }
    if (i === 1) block.message.body.deposits = [deposit];
    if (i === 9) {
      const slashing = ssz.phase0.AttesterSlashing.defaultValue();
      for (const [j, attestation] of [slashing.attestation1, slashing.attestation2].entries()) {
        const data: phase0.AttestationData = {
          ...ssz.phase0.AttestationData.defaultValue(),
          slot,
          beaconBlockRoot: Buffer.alloc(32, j + 1),
        };
        data.target.epoch = epoch;
        const root = getAttestationDataSigningRoot(config, slot, data);
        attestation.attestingIndices = [0, validatorCount];
        attestation.data = {
          ...data,
          slot: BigInt(slot),
          index: 0n,
          source: {...data.source, epoch: 0n},
          target: {...data.target, epoch: BigInt(epoch)},
        };
        attestation.signature = aggregateSignatures([
          interopSecretKey(0).sign(root),
          (wrongKey ? otherKey : newKey).sign(root),
        ]).toBytes();
      }
      block.message.body.attesterSlashings = [slashing];
    }
    generation = stateTransition(generation, block, {
      executionPayloadStatus: ExecutionPayloadStatus.valid,
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
      verifyStateRoot: false,
      verifyProposer: false,
      verifySignatures: !wrongKey,
      dontTransferCache: true,
    });
    block.message.stateRoot = generation.hashTreeRoot();
    block.signature = proposerKey
      .sign(
        computeSigningRoot(ssz[forkName].BeaconBlock, block.message, config.getDomain(slot, DOMAIN_BEACON_PROPOSER))
      )
      .toBytes();
    blocks.push(block);
  }

  pubkeyCache.reset();
  const preState = createBeaconStateView({config, stateBytes: anchorBytes, nativeStateTransition: false});
  pubkeyCache.addCandidate(validatorCount, otherKey.toPublicKey().toBytes());
  const chain = {
    config,
    bls: new BlsSingleThreadVerifier({metrics: null}),
    logger: getMockedLogger(),
    metrics: null,
    validatorMonitor: null,
    serializedCache: new SerializedCache(),
    regen: {getPreState: async () => preState},
    shufflingCache: {getSync: () => null},
    seenBlockProposers: {observeBlockRoot: () => {}, isEquivocating: () => false},
  } as unknown as BeaconChain;
  const blockInputs = blocks.map((block) => {
    const input = new MockBlockInput({
      forkName,
      slot: block.message.slot,
      blockRootHex: toRootHex(config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message)),
    });
    input.block = block;
    return input;
  });
  return {chain, blockInputs, preState};
}
