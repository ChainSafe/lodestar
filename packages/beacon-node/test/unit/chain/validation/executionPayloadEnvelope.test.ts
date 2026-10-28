import {beforeEach, describe, expect, it, vi} from "vitest";
import {SerializedList} from "@chainsafe/ssz";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {BUILDER_INDEX_SELF_BUILD, ForkName} from "@lodestar/params";
import {IBeaconStateView} from "@lodestar/state-transition";
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
    envelope.parentBeaconBlockRoot = Buffer.alloc(32, 6);
    envelope.builderIndex = BUILDER_INDEX_SELF_BUILD;
    envelope.payload.slotNumber = slot;
    envelope.payload.blockNumber = 1;
    envelope.payload.transactions = SerializedList.fromArray([Uint8Array.from([2, 1, 2, 3])]);
    setBlockHash(envelope);

    chain = getMockedBeaconChain({config});
    chain.forkChoice.getBlockDefaultStatus.mockReturnValue(generateProtoBlock({slot, blockRoot: toRootHex(blockRoot)}));
    chain.forkChoice.getBlockHex.mockReturnValue(null);
    chain.forkChoice.getFinalizedCheckpoint.mockReturnValue({epoch: 0, root: Buffer.alloc(32), rootHex: ""});
    // Bid commitments are taken from the envelope as signed, so only the block hash check can catch a changed payload
    const bidBlockHash = toRootHex(envelope.payload.blockHash);
    const bidRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(envelope.executionRequests);
    vi.mocked(chain.seenPayloadEnvelopeInputCache.get).mockReturnValue({
      proposerIndex: 0,
      hasPayloadEnvelope: () => false,
      getBuilderIndex: () => BUILDER_INDEX_SELF_BUILD,
      getBlockHashHex: () => bidBlockHash,
      getBid: () => ({executionRequestsRoot: bidRequestsRoot}),
    } as unknown as PayloadEnvelopeInput);
    chain.regen.getState.mockResolvedValue({forkName: ForkName.gloas} as unknown as IBeaconStateView);
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

  it("rejects an envelope whose parent beacon block root does not match its block hash", async () => {
    signedEnvelope.message.parentBeaconBlockRoot = Buffer.alloc(32, 7);
    await expect(validateGossipExecutionPayloadEnvelope(chain, signedEnvelope)).rejects.toMatchObject({
      type: {code: ExecutionPayloadEnvelopeErrorCode.INVALID_BLOCK_HASH},
    });
  });

  it("checks the signature before the block hash", async () => {
    signedEnvelope.message.payload.transactions = SerializedList.fromArray([Uint8Array.from([2, 9, 9, 9])]);
    vi.mocked(chain.bls.verifySignatureSets).mockResolvedValue(false);
    await expect(validateGossipExecutionPayloadEnvelope(chain, signedEnvelope)).rejects.toMatchObject({
      type: {code: ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE},
    });
  });
});
