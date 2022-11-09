import {assert} from "chai";
import {IChainConfig} from "@lodestar/config";
import {phase0, ssz} from "@lodestar/types";
import {fromHexString} from "@chainsafe/ssz";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";
import {ChainEvent} from "../../../src/chain/index.js";
import {connect} from "../../utils/network.js";
import {testLogger, LogLevel, TestLoggerOpts} from "../../utils/logger.js";

describe("sync / finalized sync", function () {
  const validatorCount = 8;
  const beaconParams: Partial<IChainConfig> = {
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

  it("should do a finalized sync from another BN", async function () {
    this.timeout("10 min");

    const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);
    const loggerNodeB = testLogger("Node-B", testLoggerOpts);
    // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
    // the node needs time to transpile/initialize bls worker threads
    const genesisSlotsDelay = 16;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * beaconParams.SECONDS_PER_SLOT!;

    const bn = await getDevBeaconNode({
      params: beaconParams,
      options: {
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true},
        chain: {blsVerifyAllMainThread: true},
      },
      validatorCount,
      genesisTime,
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

    afterEachCallbacks.push(() => Promise.all(validators.map((validator) => validator.close())));

    // stop beacon node after validators
    afterEachCallbacks.push(() => bn.close());

    await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.finalized, 240000);
    loggerNodeA.info("Node A emitted finalized checkpoint event");

    const bn2 = await getDevBeaconNode({
      params: beaconParams,
      options: {api: {rest: {enabled: false}}},
      validatorCount,
      genesisTime: bn.chain.getHeadState().genesisTime,
      logger: loggerNodeB,
    });
    afterEachCallbacks.push(() => bn2.close());

    afterEachCallbacks.push(() => bn2.close());

    const headSummary = bn.chain.forkChoice.getHead();
    const head = await bn.db.block.get(fromHexString(headSummary.blockRoot));
    if (!head) throw Error("First beacon node has no head block");
    const waitForSynced = waitForEvent<phase0.SignedBeaconBlock>(bn2.chain.emitter, ChainEvent.block, 100000, (block) =>
      ssz.phase0.SignedBeaconBlock.equals(block, head)
    );

    await connect(bn2.network, bn.network.peerId, bn.network.localMultiaddrs);

    try {
      await waitForSynced;
    } catch (e) {
      assert.fail("Failed to sync to other node in time");
    }
  });
});
