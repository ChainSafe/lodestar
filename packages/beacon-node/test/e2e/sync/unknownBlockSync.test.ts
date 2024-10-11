import {describe, it, afterEach, vi} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {ChainConfig} from "@lodestar/config";
import {phase0} from "@lodestar/types";
import {config} from "@lodestar/config/default";
import {TimestampFormatCode} from "@lodestar/logger";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {routes} from "@lodestar/api";
import {EventData, EventType} from "@lodestar/api/lib/beacon/routes/events.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";
import {ChainEvent} from "../../../src/chain/index.js";
import {NetworkEvent} from "../../../src/network/index.js";
import {connect, onPeerConnect} from "../../utils/network.js";
import {testLogger, LogLevel, TestLoggerOpts} from "../../utils/logger.js";
import {BlockError, BlockErrorCode} from "../../../src/chain/errors/index.js";
import {BlockSource, getBlockInput} from "../../../src/chain/blocks/types.js";

describe("sync / unknown block sync", function () {
  vi.setConfig({testTimeout: 40_000});

  const validatorCount = 8;
  const testParams: Pick<ChainConfig, "SECONDS_PER_SLOT"> = {
    SECONDS_PER_SLOT: 2,
  };

  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  const testCases: {id: string; event: NetworkEvent}[] = [
    {
      id: "should do an unknown block parent sync from another BN",
      event: NetworkEvent.unknownBlockParent,
    },
    {
      id: "should do an unknown block sync from another BN",
      event: NetworkEvent.unknownBlock,
    },
  ];

  for (const {id, event} of testCases) {
    it(id, async function () {
      // the node needs time to transpile/initialize bls worker threads
      const genesisSlotsDelay = 4;
      const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * testParams.SECONDS_PER_SLOT;
      const testLoggerOpts: TestLoggerOpts = {
        level: LogLevel.info,
        timestampFormat: {
          format: TimestampFormatCode.EpochSlot,
          genesisTime,
          slotsPerEpoch: SLOTS_PER_EPOCH,
          secondsPerSlot: testParams.SECONDS_PER_SLOT,
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

      afterEachCallbacks.push(() => Promise.all(validators.map((v) => v.close())));

      // stop bn after validators
      afterEachCallbacks.push(() => bn.close());

      await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.checkpoint, 240000);
      loggerNodeA.info("Node A emitted checkpoint event");

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
      });

      afterEachCallbacks.push(() => bn2.close());

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

      const headInput = getBlockInput.preData(config, head, BlockSource.gossip, null);

      switch (event) {
        case NetworkEvent.unknownBlockParent:
          await bn2.chain.processBlock(headInput).catch((e) => {
            if (e instanceof BlockError && e.type.code === BlockErrorCode.PARENT_UNKNOWN) {
              // Expected
              bn2.network.events.emit(NetworkEvent.unknownBlockParent, {
                blockInput: headInput,
                peer: bn2.network.peerId.toString(),
              });
            } else {
              throw e;
            }
          });
          break;
        case NetworkEvent.unknownBlock:
          bn2.network.events.emit(NetworkEvent.unknownBlock, {
            rootHex: headSummary.blockRoot,
            peer: bn2.network.peerId.toString(),
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
