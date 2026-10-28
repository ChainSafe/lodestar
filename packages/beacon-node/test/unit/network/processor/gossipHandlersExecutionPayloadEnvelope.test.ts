import {describe, expect, it, vi} from "vitest";
import {SerializedList} from "@chainsafe/ssz";
import {createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {BUILDER_INDEX_SELF_BUILD, ForkName} from "@lodestar/params";
import {IBeaconStateView} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {ExecutionPayloadEnvelopeErrorCode} from "../../../../src/chain/errors/index.js";
import {ChainEventEmitter, IBeaconChain} from "../../../../src/chain/index.js";
import {computeExecutionBlockHash} from "../../../../src/execution/engine/blockHash.js";
import {INetworkCore} from "../../../../src/network/core/index.js";
import {NetworkEventBus} from "../../../../src/network/events.js";
import {GossipType, SequentialGossipHandler} from "../../../../src/network/gossip/interface.js";
import {AggregatorTracker} from "../../../../src/network/processor/aggregatorTracker.js";
import {getGossipHandlers} from "../../../../src/network/processor/gossipHandlers.js";
import {PeerIdStr} from "../../../../src/util/peerId.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("gossip execution payload envelope block hash", () => {
  const config = createBeaconConfig(
    {
      ...defaultConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    },
    Buffer.alloc(32, 0)
  );
  const slot = 1;
  const tx = Uint8Array.from([2, 1, 2, 3]);

  function setup() {
    const committed = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    committed.message.builderIndex = BUILDER_INDEX_SELF_BUILD;
    committed.message.parentBeaconBlockRoot = Buffer.alloc(32, 6);
    committed.message.payload.slotNumber = slot;
    committed.message.payload.blockNumber = 1;
    committed.message.payload.transactions = SerializedList.fromArray([tx]);
    const {payload, parentBeaconBlockRoot, executionRequests} = committed.message;
    payload.blockHash = computeExecutionBlockHash(ForkName.gloas, payload, parentBeaconBlockRoot, executionRequests);

    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    const bid = block.message.body.signedExecutionPayloadBid.message;
    bid.builderIndex = BUILDER_INDEX_SELF_BUILD;
    bid.blockHash = payload.blockHash;
    bid.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(executionRequests);
    const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
    committed.message.beaconBlockRoot = blockRoot;

    const payloadInput = PayloadEnvelopeInput.createFromBlock({
      block,
      blockRootHex: toRootHex(blockRoot),
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      daOutOfRange: false,
      source: PayloadEnvelopeInputSource.gossip,
      seenTimestampSec: 0,
    });

    const logger = testLogger();
    const chain = {
      config,
      clock: new ClockStopped(slot),
      emitter: new ChainEventEmitter(),
      logger,
      metrics: null,
      forkChoice: {
        getBlockDefaultStatus: vi.fn().mockReturnValue(generateProtoBlock({slot, blockRoot: toRootHex(blockRoot)})),
        getBlockHex: vi.fn().mockReturnValue(null),
        getFinalizedCheckpoint: vi.fn().mockReturnValue({epoch: 0, root: Buffer.alloc(32), rootHex: ""}),
      },
      seenPayloadEnvelopeInputCache: {get: vi.fn().mockReturnValue(payloadInput)},
      regen: {getState: vi.fn().mockResolvedValue({forkName: ForkName.gloas} as unknown as IBeaconStateView)},
      bls: {verifySignatureSets: vi.fn().mockResolvedValue(true)},
      processExecutionPayload: vi.fn().mockResolvedValue(undefined),
      persistInvalidSszValue: vi.fn(),
      serializedCache: {set: vi.fn()},
    } as unknown as IBeaconChain;

    const handlers = getGossipHandlers(
      {
        aggregatorTracker: {} as AggregatorTracker,
        chain,
        config,
        core: {reportPeer: vi.fn()} as unknown as INetworkCore,
        events: new NetworkEventBus(),
        logger,
        metrics: null,
      },
      {}
    );
    const handler = handlers[GossipType.execution_payload] as SequentialGossipHandler<GossipType.execution_payload>;

    async function send(envelope: gloas.SignedExecutionPayloadEnvelope): Promise<void> {
      await handler({
        gossipData: {serializedData: ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope)},
        peerIdStr: "16Uiu2HAmTestGossipPeer" as PeerIdStr,
        seenTimestampSec: 0,
        topic: {boundary: {fork: ForkName.gloas, epoch: 0}, type: GossipType.execution_payload},
      });
      // The envelope is attached to its input via callInNextEventLoop
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    function variant(transactions: Uint8Array[]): gloas.SignedExecutionPayloadEnvelope {
      const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.clone(committed);
      envelope.message.payload.transactions = SerializedList.fromArray(transactions);
      return envelope;
    }

    return {committed, payloadInput, send, variant};
  }

  it("rejects a signed variant with a trailing empty transaction without marking it seen", async () => {
    const {committed, payloadInput, send, variant} = setup();

    await expect(send(variant([tx, new Uint8Array(0)]))).rejects.toMatchObject({
      type: {code: ExecutionPayloadEnvelopeErrorCode.ZERO_LENGTH_TRANSACTION},
    });
    expect(payloadInput.hasPayloadEnvelope()).toBe(false);

    await send(committed);
    expect(payloadInput.hasPayloadEnvelope()).toBe(true);
  });

  it("rejects a signed variant with other contents under the committed hash without marking it seen", async () => {
    const {committed, payloadInput, send, variant} = setup();

    await expect(send(variant([Uint8Array.from([2, 9, 9, 9])]))).rejects.toMatchObject({
      type: {code: ExecutionPayloadEnvelopeErrorCode.INVALID_BLOCK_HASH},
    });
    expect(payloadInput.hasPayloadEnvelope()).toBe(false);

    await send(committed);
    expect(payloadInput.hasPayloadEnvelope()).toBe(true);
  });
});
