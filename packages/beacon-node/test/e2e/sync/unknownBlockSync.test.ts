import {IChainConfig} from "@lodestar/config";
import {phase0, ssz} from "@lodestar/types";
import {fromHexString} from "@chainsafe/ssz";
import {TimestampFormatCode} from "@lodestar/utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";
import {ChainEvent} from "../../../src/chain/index.js";
import {NetworkEvent} from "../../../src/network/index.js";
import {connect} from "../../utils/network.js";
import {testLogger, LogLevel, TestLoggerOpts} from "../../utils/logger.js";
import {BlockError, BlockErrorCode} from "../../../src/chain/errors/index.js";

describe("sync / unknown block sync", function () {
  const validatorCount = 8;
  const testParams: Pick<IChainConfig, "SECONDS_PER_SLOT"> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SECONDS_PER_SLOT: 2,
  };

  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  it("should do an unknown block sync from another BN", async function () {
    this.timeout("10 min");

    // the node needs time to transpile/initialize bls worker threads
    const genesisSlotsDelay = 16;
    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * testParams.SECONDS_PER_SLOT;
    const testLoggerOpts: TestLoggerOpts = {
      logLevel: LogLevel.info,
      timestampFormat: {
        format: TimestampFormatCode.EpochSlot,
        genesisTime,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        secondsPerSlot: testParams.SECONDS_PER_SLOT,
      },
    };

    const loggerNodeA = testLogger("Node-A", testLoggerOpts);
    const loggerNodeB = testLogger("Node-B", testLoggerOpts);

    const bn = await getDevBeaconNode({
      params: testParams,
      options: {
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true},
        chain: {blsVerifyAllMainThread: true},
      },
      validatorCount,
      logger: loggerNodeA,
    });

    afterEachCallbacks.push(() => bn.close());

    const {validators} = await getAndInitDevValidators({
      node: bn,
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
      genesisTime: bn.chain.getHeadState().genesisTime,
      logger: loggerNodeB,
    });

    afterEachCallbacks.push(() => bn2.close());

    const headSummary = bn.chain.forkChoice.getHead();
    const head = await bn.db.block.get(fromHexString(headSummary.blockRoot));
    if (!head) throw Error("First beacon node has no head block");
    const waitForSynced = waitForEvent<phase0.SignedBeaconBlock>(bn2.chain.emitter, ChainEvent.block, 100000, (block) =>
      ssz.phase0.SignedBeaconBlock.equals(block, head)
    );

    await connect(bn2.network, bn.network.peerId, bn.network.localMultiaddrs);
    await bn2.chain.processBlock(head).catch((e) => {
      if (e instanceof BlockError && e.type.code === BlockErrorCode.PARENT_UNKNOWN) {
        // Expected
        bn2.network.events.emit(NetworkEvent.unknownBlockParent, head, bn2.network.peerId.toString());
      } else {
        throw e;
      }
    });

    // Wait for NODE-A head to be processed in NODE-B without range sync
    await waitForSynced;
  });
});
