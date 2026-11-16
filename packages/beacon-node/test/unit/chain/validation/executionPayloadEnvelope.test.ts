import {beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {PayloadStatus} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {
  ExecutionPayloadEnvelopeError,
  ExecutionPayloadEnvelopeErrorCode,
  GossipAction,
} from "../../../../src/chain/errors/index.js";
import {validateGossipExecutionPayloadEnvelope} from "../../../../src/chain/validation/executionPayloadEnvelope.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("validateGossipExecutionPayloadEnvelope", () => {
  const config = createChainForkConfig({
    ...configDef,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 0,
  });
  const slot = 5;
  const parentRoot = Buffer.alloc(32, 0x77);

  let chain: MockedBeaconChain;
  /** The envelope the block's bid commits to */
  let envelope: gloas.ExecutionPayloadEnvelope;
  let blockRootHex: string;
  let payloadInput: PayloadEnvelopeInput;

  beforeEach(() => {
    envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
    envelope.payload.slotNumber = slot;
    envelope.payload.blockHash = Buffer.alloc(32, 0x11);
    envelope.executionRequests.withdrawals.push(ssz.electra.WithdrawalRequest.defaultValue());
    envelope.parentBeaconBlockRoot = parentRoot;

    // The envelope is not signed, it is tied to the block only through the commitments of the block's bid
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.parentRoot = parentRoot;
    const bid = block.message.body.signedExecutionPayloadBid.message;
    bid.gasLimit = 30_000_000n;
    bid.blockHash = envelope.payload.blockHash;
    bid.payloadRoot = ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.payload);
    bid.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(envelope.executionRequests);
    const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
    blockRootHex = toRootHex(blockRoot);
    envelope.beaconBlockRoot = blockRoot;

    payloadInput = PayloadEnvelopeInput.createFromBlock({
      block,
      blockRootHex,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      daOutOfRange: false,
      source: PayloadEnvelopeInputSource.gossip,
      seenTimestampSec: 0,
    });

    chain = getMockedBeaconChain({config});
    chain.forkChoice.getBlockDefaultStatus.mockReturnValue(
      generateProtoBlock({
        slot,
        blockRoot: blockRootHex,
        parentRoot: toRootHex(parentRoot),
        executionPayloadGasLimit: 0,
        payloadRoot: toRootHex(bid.payloadRoot),
      })
    );
    // the FULL variant is not in fork choice, the payload is not imported yet
    chain.forkChoice.getBlockHex.mockReturnValue(null);
    chain.forkChoice.getFinalizedCheckpoint.mockReturnValue({epoch: 0, root: Buffer.alloc(32), rootHex: ""});
    vi.mocked(chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(payloadInput);
  });

  it("accepts the envelope the block's bid commits to", async () => {
    await expect(validateGossipExecutionPayloadEnvelope(chain, envelope)).resolves.toBeUndefined();

    expect(chain.forkChoice.getBlockHex).toHaveBeenCalledWith(blockRootHex, PayloadStatus.FULL);
    // the envelope is not signed, nothing to verify with BLS and no state is needed
    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
    expect(chain.regen.getBlockSlotState).not.toHaveBeenCalled();
  });

  it("ignores an envelope whose block root is unknown", async () => {
    chain.forkChoice.getBlockDefaultStatus.mockReturnValue(null);

    await expectRejectedWithLodestarError(
      validateGossipExecutionPayloadEnvelope(chain, envelope),
      new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
        code: ExecutionPayloadEnvelopeErrorCode.BLOCK_ROOT_UNKNOWN,
        blockRoot: blockRootHex,
      })
    );
  });

  it.each([
    {name: "the payload is imported in fork choice", imported: true},
    {name: "the seen cache already holds an envelope for the block", imported: false},
  ])("ignores an envelope if $name", async ({imported}) => {
    if (imported) {
      chain.forkChoice.getBlockHex.mockReturnValue(
        generateProtoBlock({slot, blockRoot: blockRootHex, payloadStatus: PayloadStatus.FULL})
      );
    } else {
      payloadInput.addPayloadEnvelope({
        envelope: ssz.gloas.ExecutionPayloadEnvelope.clone(envelope),
        source: PayloadEnvelopeInputSource.gossip,
        seenTimestampSec: 0,
      });
    }

    const promise = validateGossipExecutionPayloadEnvelope(chain, envelope);
    await expectRejectedWithLodestarError(
      promise,
      new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
        code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN,
        blockRoot: blockRootHex,
        slot,
      })
    );
    await expect(promise).rejects.toHaveProperty("action", GossipAction.IGNORE);
  });

  it("rejects an envelope whose parent beacon block root is not the block's parent root", async () => {
    const wrongParentRoot = Buffer.alloc(32, 0x88);
    envelope.parentBeaconBlockRoot = wrongParentRoot;

    const promise = validateGossipExecutionPayloadEnvelope(chain, envelope);
    await expectRejectedWithLodestarError(
      promise,
      new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
        code: ExecutionPayloadEnvelopeErrorCode.PARENT_BEACON_BLOCK_ROOT_MISMATCH,
        slot,
        root: blockRootHex,
        envelopeParentRoot: toRootHex(wrongParentRoot),
        blockParentRoot: toRootHex(parentRoot),
      })
    );
    await expect(promise).rejects.toHaveProperty("action", GossipAction.REJECT);
  });

  it("rejects an envelope whose payload root is not the one the bid commits to", async () => {
    const bidPayloadRoot = ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.payload);
    // same block hash, slot and requests, another payload
    envelope.payload.gasUsed += 1;

    const promise = validateGossipExecutionPayloadEnvelope(chain, envelope);
    await expectRejectedWithLodestarError(
      promise,
      new ExecutionPayloadEnvelopeError(GossipAction.REJECT, {
        code: ExecutionPayloadEnvelopeErrorCode.PAYLOAD_ROOT_MISMATCH,
        slot,
        root: blockRootHex,
        envelopePayloadRoot: toRootHex(ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.payload)),
        bidPayloadRoot: toRootHex(bidPayloadRoot),
      })
    );
    await expect(promise).rejects.toHaveProperty("action", GossipAction.REJECT);
  });
});
