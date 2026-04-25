import {afterEach, describe, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ChainConfig} from "@lodestar/config";
import {TimestampFormatCode} from "@lodestar/logger";
import {LogLevel, TestLoggerOpts, testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {gloas} from "@lodestar/types";
import {BlockInputNoData} from "../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../src/chain/blocks/blockInput/types.js";
import {ChainEvent} from "../../../src/chain/emitter.js";
import {BlockError, BlockErrorCode} from "../../../src/chain/errors/index.js";
import {INTEROP_BLOCK_HASH} from "../../../src/node/utils/interop/state.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {connect, onPeerConnect} from "../../utils/network.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";

describe("sync / unknown block sync thru gloas", () => {
  vi.setConfig({testTimeout: 90_000});

  const validatorCount = 8;
  const ELECTRA_FORK_EPOCH = 0;
  const FULU_FORK_EPOCH = 0;
  const GLOAS_FORK_EPOCH = 1;
  const SLOT_DURATION_MS = 2000;
  const testParams: Partial<ChainConfig> = {
    SLOT_DURATION_MS,
    ALTAIR_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    BELLATRIX_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    CAPELLA_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    DENEB_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    ELECTRA_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    FULU_FORK_EPOCH: FULU_FORK_EPOCH,
    GLOAS_FORK_EPOCH: GLOAS_FORK_EPOCH,
    BLOB_SCHEDULE: [
      {
        EPOCH: GLOAS_FORK_EPOCH,
        MAX_BLOBS_PER_BLOCK: 3,
      },
    ],
  };

  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  const testCases: {id: string; event: ChainEvent}[] = [
    {
      id: "should do an unknown block parent sync from another BN",
      event: ChainEvent.blockUnknownParent,
    },
    {
      id: "should do an unknown block sync from another BN",
      event: ChainEvent.unknownBlockRoot,
    },
    {
      id: "should do an incompleteBlockInput sync from another BN",
      event: ChainEvent.incompleteBlockInput,
    },
    {
      id: "should do an unknownEnvelopeBlockRoot sync from another BN",
      event: ChainEvent.unknownEnvelopeBlockRoot,
    },
    {
      id: "should do an envelopeUnknownBlock sync from another BN",
      event: ChainEvent.envelopeUnknownBlock,
    },
    {
      id: "should do an incompletePayloadEnvelope sync from another BN",
      event: ChainEvent.incompletePayloadEnvelope,
    },
  ];

  for (const {id, event} of testCases) {
    it(id, async () => {
      // the node needs time to transpile/initialize bls worker threads
      const genesisSlotsDelay = 4;
      const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * (SLOT_DURATION_MS / 1000);
      const testLoggerOpts: TestLoggerOpts = {
        level: LogLevel.info,
        timestampFormat: {
          format: TimestampFormatCode.EpochSlot,
          genesisTime,
          slotsPerEpoch: SLOTS_PER_EPOCH,
          secondsPerSlot: SLOT_DURATION_MS / 1000,
        },
      };

      const loggerNodeA = testLogger("UnknownSync-Node-A", testLoggerOpts);
      const loggerNodeB = testLogger("UnknownSync-Node-B", testLoggerOpts);
      const gloasStartSlot = GLOAS_FORK_EPOCH * SLOTS_PER_EPOCH;
      const targetSlot = gloasStartSlot + 1;

      const bn = await getDevBeaconNode({
        params: testParams,
        options: {
          sync: {isSingleNode: true},
          network: {allowPublishToZeroPeers: true},
          chain: {blsVerifyAllMainThread: true},
        },
        validatorCount,
        genesisTime,
        logger: loggerNodeA,
        eth1BlockHash: Uint8Array.from(INTEROP_BLOCK_HASH),
      });

      const waitForTargetPayloadOnNodeA = waitForEvent<
        routes.events.EventData[routes.events.EventType.executionPayload]
      >(bn.chain.emitter, routes.events.EventType.executionPayload, 240000, ({slot}) => slot === targetSlot);

      const {validators} = await getAndInitDevValidators({
        node: bn,
        logPrefix: "UnknownSync",
        validatorsPerClient: validatorCount,
        validatorClientCount: 1,
        startIndex: 0,
        useRestApi: false,
        testLoggerOpts,
      });

      afterEachCallbacks.push(() => Promise.all(validators.map((v) => v.close().catch(() => {}))));

      // stop bn after validators
      afterEachCallbacks.push(() => bn.close().catch(() => {}));

      const payloadEvent = await waitForTargetPayloadOnNodeA;
      loggerNodeA.info("Node A selected gloas payload target", {slot: payloadEvent.slot, root: payloadEvent.blockRoot});

      const bn2 = await getDevBeaconNode({
        params: testParams,
        options: {
          api: {rest: {enabled: false}},
          sync: {disableRangeSync: true},
          chain: {blsVerifyAllMainThread: true},
        },
        validatorCount,
        genesisTime,
        logger: loggerNodeB,
        eth1BlockHash: Uint8Array.from(INTEROP_BLOCK_HASH),
      });

      afterEachCallbacks.push(() => bn2.close().catch(() => {}));

      const headSlot = payloadEvent.slot;
      const headRootHex = payloadEvent.blockRoot;
      const headResult = await bn.chain.getBlockByRoot(headRootHex);
      if (headResult === null) {
        throw Error("Node A is missing the selected gloas head block");
      }
      const head = headResult.block as gloas.SignedBeaconBlock;
      if (head.message.body.signedExecutionPayloadBid.message.blobKzgCommitments.length === 0) {
        throw Error(`Expected gloas test target at slot=${targetSlot} to have blob commitments`);
      }

      const waitForSynced = waitForEvent<routes.events.EventData[routes.events.EventType.head]>(
        bn2.chain.emitter,
        routes.events.EventType.head,
        100000,
        ({block}) => block === headRootHex
      );

      const connected = Promise.all([onPeerConnect(bn2.network), onPeerConnect(bn.network)]);
      await connect(bn2.network, bn.network);
      await connected;
      loggerNodeA.info("Node A connected to Node B");

      const sourcePeerId = bn.network.peerId.toString();
      const headInput = BlockInputNoData.createFromBlock({
        block: head,
        blockRootHex: headRootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Math.floor(Date.now() / 1000),
        forkName: bn.chain.config.getForkName(headSlot),
        daOutOfRange: false,
      });
      let waitForPayloadImported:
        | Promise<routes.events.EventData[routes.events.EventType.executionPayload]>
        | undefined;

      switch (event) {
        case ChainEvent.blockUnknownParent:
          await bn2.chain.processBlock(headInput).catch((e) => {
            loggerNodeB.info("Error processing block", {slot: headInput.slot, code: e.type.code});
            if (
              e instanceof BlockError &&
              (e.type.code === BlockErrorCode.PARENT_UNKNOWN || e.type.code === BlockErrorCode.PARENT_PAYLOAD_UNKNOWN)
            ) {
              // Expected
              bn2.chain.emitter.emit(ChainEvent.blockUnknownParent, {
                blockInput: headInput,
                peer: sourcePeerId,
                source: BlockInputSource.gossip,
              });
            } else {
              throw e;
            }
          });
          break;
        case ChainEvent.unknownBlockRoot:
          bn2.chain.emitter.emit(ChainEvent.unknownBlockRoot, {
            rootHex: headRootHex,
            peer: sourcePeerId,
            source: BlockInputSource.gossip,
          });
          break;
        case ChainEvent.incompleteBlockInput:
          bn2.chain.emitter.emit(ChainEvent.incompleteBlockInput, {
            blockInput: headInput,
            peer: sourcePeerId,
            source: BlockInputSource.gossip,
          });
          break;
        case ChainEvent.unknownEnvelopeBlockRoot:
          bn2.chain.emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {
            rootHex: headRootHex,
            peer: sourcePeerId,
            source: BlockInputSource.gossip,
          });
          break;
        case ChainEvent.envelopeUnknownBlock: {
          // Node A produced the head; its cache has the full signed envelope (populated via
          // publishExecutionPayloadEnvelope -> payloadInput.addPayloadEnvelope).
          const payloadInputOnA = bn.chain.seenPayloadEnvelopeInputCache.get(headRootHex);
          if (!payloadInputOnA?.hasPayloadEnvelope()) {
            throw Error(`Expected node A to have signed envelope for ${headRootHex}`);
          }
          // Register the waiter BEFORE the emit so the executionPayload event isn't missed.
          // The handler fetches the unknown block via byRoot, reconciles with the envelope,
          // and imports it via processExecutionPayload, which fires this event.
          waitForPayloadImported = waitForEvent<routes.events.EventData[routes.events.EventType.executionPayload]>(
            bn2.chain.emitter,
            routes.events.EventType.executionPayload,
            100000,
            ({blockRoot}) => blockRoot === headRootHex
          );
          bn2.chain.emitter.emit(ChainEvent.envelopeUnknownBlock, {
            envelope: payloadInputOnA.getPayloadEnvelope(),
            peer: sourcePeerId,
            source: BlockInputSource.gossip,
          });
          break;
        }
        case ChainEvent.incompletePayloadEnvelope: {
          // get the chain started with an unknownBlockRoot
          bn2.chain.emitter.emit(ChainEvent.unknownBlockRoot, {
            rootHex: headRootHex,
            peer: sourcePeerId,
            source: BlockInputSource.gossip,
          });
          break;
        }
        default:
          throw Error("Unknown event type");
      }

      // Wait for the block root to be processed in node B. The unknown-block-sync flow imports
      // parent payloads as needed to satisfy sanity checks but does not fetch the head block's
      // own payload envelope (which would normally arrive via gossip on a live network).
      await waitForSynced;
      // For envelopeUnknownBlock, also wait until the payload itself is imported on node B
      // (handler fetches the missing block via byRoot, reconciles with the envelope, then imports).
      if (waitForPayloadImported) {
        await waitForPayloadImported;
      }

      switch (event) {
        case ChainEvent.incompletePayloadEnvelope: {
          // After it syncs, retrieve the PayloadEnvelopeInput created during block import
          // and emit incompletePayloadEnvelope to exercise the sync handler.
          const payloadInput = bn2.chain.seenPayloadEnvelopeInputCache.get(headRootHex);
          if (!payloadInput) {
            throw Error(`Expected PayloadEnvelopeInput for ${headRootHex} after block sync`);
          }
          const waitForPayloadImported = waitForEvent<
            routes.events.EventData[routes.events.EventType.executionPayload]
          >(
            bn2.chain.emitter,
            routes.events.EventType.executionPayload,
            100000,
            ({blockRoot}) => blockRoot === headRootHex
          );
          bn2.chain.emitter.emit(ChainEvent.incompletePayloadEnvelope, {
            payloadInput,
            peer: sourcePeerId,
            source: BlockInputSource.gossip,
          });
          await waitForPayloadImported;
          break;
        }
        default:
          break;
      }
    });
  }
});
