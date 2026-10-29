import {beforeEach, describe, expect, it, vi} from "vitest";
import {SerializedList} from "@chainsafe/ssz";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {BUILDER_INDEX_SELF_BUILD, ForkName} from "@lodestar/params";
import {IBeaconStateView, computeTimeAtSlot} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {ExecutionPayloadEnvelopeErrorCode} from "../../../../src/chain/errors/index.js";
import {validateGossipExecutionPayloadEnvelope} from "../../../../src/chain/validation/executionPayloadEnvelope.js";
import {computeExecutionBlockHash} from "../../../../src/execution/engine/blockHash.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("validateGossipExecutionPayloadEnvelope", () => {
  const config = createBeaconConfig(
    createChainForkConfig({
      ...configDef,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    }),
    Buffer.alloc(32, 0)
  );
  const slot = 2;
  const blockRoot = Buffer.alloc(32, 5);
  const parentRoot = Buffer.alloc(32, 6);
  const latestBlockHash = Buffer.alloc(32, 8);
  const genesisTime = 1000;
  const withdrawals = [{index: 0, validatorIndex: 1, address: Buffer.alloc(20, 9), amount: BigInt(32e9)}];
  let chain: MockedBeaconChain;
  let signedEnvelope: gloas.SignedExecutionPayloadEnvelope;

  function setBlockHash(envelope: gloas.ExecutionPayloadEnvelope): void {
    envelope.payload.blockHash = computeExecutionBlockHash(
      ForkName.gloas,
      envelope.payload,
      envelope.parentBeaconBlockRoot,
      envelope.executionRequests
    );
  }

  beforeEach(() => {
    signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    const envelope = signedEnvelope.message;
    envelope.beaconBlockRoot = blockRoot;
    envelope.parentBeaconBlockRoot = parentRoot;
    envelope.builderIndex = BUILDER_INDEX_SELF_BUILD;
    const {payload} = envelope;
    payload.slotNumber = slot;
    payload.blockNumber = 1;
    payload.parentHash = latestBlockHash;
    payload.prevRandao = Buffer.alloc(32, 1);
    payload.gasLimit = 30_000_000;
    payload.timestamp = computeTimeAtSlot(config, slot, genesisTime);
    payload.withdrawals = withdrawals;
    payload.transactions = SerializedList.fromArray([Uint8Array.from([2, 1, 2, 3])]);
    setBlockHash(envelope);

    chain = getMockedBeaconChain({config});
    chain.forkChoice.getBlockDefaultStatus.mockReturnValue(
      generateProtoBlock({slot, blockRoot: toRootHex(blockRoot), parentRoot: toRootHex(parentRoot)})
    );
    chain.forkChoice.getBlockHex.mockReturnValue(null);
    chain.forkChoice.getFinalizedCheckpoint.mockReturnValue({epoch: 0, root: Buffer.alloc(32), rootHex: ""});
    // Bid commitments are taken from the envelope as signed, so only the block hash check can catch a changed payload
    const bidBlockHash = toRootHex(payload.blockHash);
    const bid = {
      prevRandao: payload.prevRandao,
      gasLimit: BigInt(payload.gasLimit),
      executionRequestsRoot: ssz.gloas.ExecutionRequests.hashTreeRoot(envelope.executionRequests),
    };
    vi.mocked(chain.seenPayloadEnvelopeInputCache.get).mockReturnValue({
      proposerIndex: 0,
      hasPayloadEnvelope: () => false,
      getBuilderIndex: () => BUILDER_INDEX_SELF_BUILD,
      getBlockHashHex: () => bidBlockHash,
      getBid: () => bid,
    } as unknown as PayloadEnvelopeInput);
    chain.regen.getState.mockResolvedValue({
      forkName: ForkName.gloas,
      latestBlockHash,
      genesisTime,
      payloadExpectedWithdrawals: withdrawals,
    } as unknown as IBeaconStateView);
  });

  it("accepts an envelope whose payload hashes to its block hash", async () => {
    await expect(validateGossipExecutionPayloadEnvelope(chain, signedEnvelope)).resolves.toBeUndefined();
  });

  it("rejects an envelope whose payload does not hash to its block hash", async () => {
    signedEnvelope.message.payload.transactions = SerializedList.fromArray([Uint8Array.from([2, 9, 9, 9])]);
    await expect(validateGossipExecutionPayloadEnvelope(chain, signedEnvelope)).rejects.toMatchObject({
      type: {code: ExecutionPayloadEnvelopeErrorCode.INVALID_BLOCK_HASH},
    });
  });

  it.each<[string, (payload: gloas.ExecutionPayload, envelope: gloas.ExecutionPayloadEnvelope) => void, string]>([
    [
      "parent beacon block root differs from the block parent root",
      (_, envelope) => {
        envelope.parentBeaconBlockRoot = Buffer.alloc(32, 7);
      },
      ExecutionPayloadEnvelopeErrorCode.PARENT_BEACON_BLOCK_ROOT_MISMATCH,
    ],
    [
      "prev randao differs from the bid",
      (payload) => {
        payload.prevRandao = Buffer.alloc(32, 2);
      },
      ExecutionPayloadEnvelopeErrorCode.PREV_RANDAO_MISMATCH,
    ],
    [
      "gas limit differs from the bid",
      (payload) => {
        payload.gasLimit += 1;
      },
      ExecutionPayloadEnvelopeErrorCode.GAS_LIMIT_MISMATCH,
    ],
    [
      "parent hash differs from the state latest block hash",
      (payload) => {
        payload.parentHash = Buffer.alloc(32, 3);
      },
      ExecutionPayloadEnvelopeErrorCode.PARENT_HASH_MISMATCH,
    ],
    [
      "timestamp is not the slot time",
      (payload) => {
        payload.timestamp += 1;
      },
      ExecutionPayloadEnvelopeErrorCode.INVALID_TIMESTAMP,
    ],
    [
      "withdrawals differ from the state expected withdrawals",
      (payload) => {
        payload.withdrawals = [];
      },
      ExecutionPayloadEnvelopeErrorCode.WITHDRAWALS_MISMATCH,
    ],
  ])("rejects an envelope whose %s", async (_, mutate, code) => {
    mutate(signedEnvelope.message.payload, signedEnvelope.message);
    await expect(validateGossipExecutionPayloadEnvelope(chain, signedEnvelope)).rejects.toMatchObject({type: {code}});
    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
  });

  it("checks the block hash before the signature", async () => {
    signedEnvelope.message.payload.transactions = SerializedList.fromArray([Uint8Array.from([2, 9, 9, 9])]);
    vi.mocked(chain.bls.verifySignatureSets).mockResolvedValue(false);
    await expect(validateGossipExecutionPayloadEnvelope(chain, signedEnvelope)).rejects.toMatchObject({
      type: {code: ExecutionPayloadEnvelopeErrorCode.INVALID_BLOCK_HASH},
    });
    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature on an envelope with a valid block hash", async () => {
    vi.mocked(chain.bls.verifySignatureSets).mockResolvedValue(false);
    await expect(validateGossipExecutionPayloadEnvelope(chain, signedEnvelope)).rejects.toMatchObject({
      type: {code: ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE},
    });
  });
});
