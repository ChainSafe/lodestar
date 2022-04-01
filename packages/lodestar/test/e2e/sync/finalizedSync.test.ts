import {IChainConfig} from "@chainsafe/lodestar-config";
import {assert} from "chai";
import {getDevBeaconNode} from "../../utils/node/beacon";
import {waitForEvent} from "../../utils/events/resolver";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {getAndInitDevValidators} from "../../utils/node/validator";
import {ChainEvent} from "../../../src/chain";
import {Network} from "../../../src/network";
import {connect} from "../../utils/network";
import {testLogger, LogLevel, TestLoggerOpts} from "../../utils/logger";
import {fromHexString} from "@chainsafe/ssz";

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

    const bn = await getDevBeaconNode({
      params: beaconParams,
      options: {sync: {isSingleNode: true}, network: {allowPublishToZeroPeers: true}},
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

    afterEachCallbacks.push(() => Promise.all(validators.map((validator) => validator.stop())));

    await Promise.all(validators.map((validator) => validator.start()));
    afterEachCallbacks.push(() => Promise.all(validators.map((v) => v.stop())));
    // stop beacon node after validators
    afterEachCallbacks.push(() => bn.close());

    await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.finalized, 240000);
    loggerNodeA.important("Node A emitted finalized checkpoint event");

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

    await connect(bn2.network as Network, bn.network.peerId, bn.network.localMultiaddrs);

    try {
      await waitForSynced;
    } catch (e) {
      assert.fail("Failed to sync to other node in time");
    }
  });
});
