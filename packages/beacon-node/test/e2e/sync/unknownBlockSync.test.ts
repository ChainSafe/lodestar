import {fromHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {EventData, EventType} from "@lodestar/api/lib/beacon/routes/events.js";
import {ChainConfig} from "@lodestar/config";
import {TimestampFormatCode} from "@lodestar/logger";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {afterEach, describe, it, vi} from "vitest";
import {BlockInputColumns} from "../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../src/chain/blocks/blockInput/types.js";
import {ChainEvent} from "../../../src/chain/emitter.js";
import {BlockError, BlockErrorCode} from "../../../src/chain/errors/index.js";
import {INTEROP_BLOCK_HASH} from "../../../src/node/utils/interop/state.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {LogLevel, TestLoggerOpts, testLogger} from "../../utils/logger.js";
import {connect, onPeerConnect} from "../../utils/network.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";
import {fulu} from "@lodestar/types";

describe("sync / unknown block sync for fulu", () => {
  vi.setConfig({testTimeout: 40_000});

  const validatorCount = 8;
  const ELECTRA_FORK_EPOCH = 0;
  const FULU_FORK_EPOCH = 1;
  const SECONDS_PER_SLOT = 2;
  const testParams: Partial<ChainConfig> = {
    SECONDS_PER_SLOT,
    ALTAIR_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    BELLATRIX_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    CAPELLA_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    DENEB_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    ELECTRA_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    FULU_FORK_EPOCH: FULU_FORK_EPOCH,
    BLOB_SCHEDULE: [
      {
        EPOCH: 1,
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
      event: ChainEvent.unknownParent,
    },
    {
      id: "should do an unknown block sync from another BN",
      event: ChainEvent.unknownBlockRoot,
    },
    // TODO: new event postfulu for unknownBlockInput
  ];

  for (const {id, event} of testCases) {
    it(id, async () => {
      // the node needs time to transpile/initialize bls worker threads
      const genesisSlotsDelay = 4;
      const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * SECONDS_PER_SLOT;
      const testLoggerOpts: TestLoggerOpts = {
        level: LogLevel.info,
        timestampFormat: {
          format: TimestampFormatCode.EpochSlot,
          genesisTime,
          slotsPerEpoch: SLOTS_PER_EPOCH,
          secondsPerSlot: SECONDS_PER_SLOT,
        },
      };

      const loggerNodeA = testLogger("UnknownSync-Node-A", testLoggerOpts);
      const loggerNodeB = testLogger("UnknownSync-Node-B", testLoggerOpts);

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

      // wait until the 2nd slot of fulu
      await waitForEvent<EventData[EventType.head]>(
        bn.chain.emitter,
        routes.events.EventType.head,
        240000,
        ({slot}) => slot === FULU_FORK_EPOCH * SLOTS_PER_EPOCH + 1
      );
      loggerNodeA.info("Node A emitted head event", {slot: bn.chain.forkChoice.getHead().slot});

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

      const headSummary = bn.chain.forkChoice.getHead();
      const head = await bn.db.block.get(fromHexString(headSummary.blockRoot));
      if (!head) throw Error("First beacon node has no head block");
      const waitForSynced = waitForEvent<EventData[EventType.head]>(
        bn2.chain.emitter,
        routes.events.EventType.head,
        100000,
        ({block}) => block === headSummary.blockRoot
      );

      const connected = Promise.all([onPeerConnect(bn2.network), onPeerConnect(bn.network)]);
      await connect(bn2.network, bn.network);
      await connected;
      loggerNodeA.info("Node A connected to Node B");

      const headInput = BlockInputColumns.createFromBlock({
        block: head as fulu.SignedBeaconBlock,
        blockRootHex: headSummary.blockRoot,
        source: BlockInputSource.gossip,
        seenTimestampSec: Math.floor(Date.now() / 1000),
        forkName: bn.chain.config.getForkName(head.message.slot),
        daOutOfRange: false,
        sampledColumns: bn2.network.custodyConfig.sampledColumns,
        custodyColumns: bn2.network.custodyConfig.custodyColumns,
      });

      switch (event) {
        case ChainEvent.unknownParent:
          await bn2.chain.processBlock(headInput).catch((e) => {
            loggerNodeB.info("Error processing block", {slot: headInput.slot, code: e.type.code});
            if (e instanceof BlockError && e.type.code === BlockErrorCode.PARENT_UNKNOWN) {
              // Expected
              bn2.chain.emitter.emit(ChainEvent.unknownParent, {
                blockInput: headInput,
                peer: bn2.network.peerId.toString(),
                source: BlockInputSource.gossip,
              });
            } else {
              throw e;
            }
          });
          break;
        case ChainEvent.unknownBlockRoot:
          bn2.chain.emitter.emit(ChainEvent.unknownBlockRoot, {
            rootSlot: {root: headSummary.blockRoot},
            peer: bn2.network.peerId.toString(),
            source: BlockInputSource.gossip,
          });
          break;
        default:
          throw Error("Unknown event type");
      }

      // Wait for NODE-A head to be processed in NODE-B without range sync
      await waitForSynced;
    });
  }
});
