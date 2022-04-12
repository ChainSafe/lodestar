import {expect} from "chai";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {altair, phase0} from "@chainsafe/lodestar-types";
import {fromHexString} from "@chainsafe/ssz";
import {SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";
import {ChainEvent} from "../../../src/chain";
import {getDevBeaconNode} from "../../utils/node/beacon";
import {waitForEvent} from "../../utils/events/resolver";
import {getAndInitDevValidators} from "../../utils/node/validator";
import {testLogger, LogLevel, TestLoggerOpts} from "../../utils/logger";

describe("syncCommittee / sync committee", function () {
  const validatorCount = 8;
  const beaconParams: Partial<IChainConfig> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SECONDS_PER_SLOT: 2,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    ALTAIR_FORK_EPOCH: 0,
  };

  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  it("should have right sync committees count on finalized block", async function () {
    this.timeout("10 min");

    const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);

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

    const headSummary = bn.chain.forkChoice.getHead();
    const head = (await bn.db.block.get(fromHexString(headSummary.blockRoot))) as altair.SignedBeaconBlock;

    expect(head.message.body.syncAggregate.syncCommitteeBits.getTrueBitIndexes().length).to.equal(
      SYNC_COMMITTEE_SIZE,
      "Wrong sync committee size"
    );
  });
});
