import {IChainConfig} from "@chainsafe/lodestar-config";
import {getDevBeaconNode} from "../../utils/node/beacon";
import {waitForEvent} from "../../utils/events/resolver";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {getAndInitDevValidators} from "../../utils/node/validator";
import {ChainEvent} from "../../../src/chain";
import {Network} from "../../../src/network";
import {connect} from "../../utils/network";
import {testLogger, LogLevel, TestLoggerOpts} from "../../utils/logger";
import {fromHexString} from "@chainsafe/ssz";
import {TimestampFormatCode} from "@chainsafe/lodestar-utils";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {BlockError, BlockErrorCode} from "../../../src/chain/errors";

describe("sync / unknown block sync", function () {
  const validatorCount = 8;
  const testParams: Pick<IChainConfig, "SECONDS_PER_SLOT"> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SECONDS_PER_SLOT: 2,
  };

  it("should do an unknown block sync from another BN", async function () {
    this.timeout("10 min");

    const genesisTime = Math.floor(Date.now() / 1000) + 2 * testParams.SECONDS_PER_SLOT;
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
      options: {sync: {isSingleNode: true}},
      validatorCount,
      logger: loggerNodeA,
    });
    const {validators} = await getAndInitDevValidators({
      node: bn,
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
    });

    await Promise.all(validators.map((validator) => validator.start()));

    await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.checkpoint, 240000);
    loggerNodeA.important("Node A emitted checkpoint event");

    const bn2 = await getDevBeaconNode({
      params: testParams,
      options: {api: {rest: {enabled: false}}, sync: {disableRangeSync: true}},
      validatorCount,
      genesisTime: bn.chain.getHeadState().genesisTime,
      logger: loggerNodeB,
    });

    const headSummary = bn.chain.forkChoice.getHead();
    const head = await bn.db.block.get(fromHexString(headSummary.blockRoot));
    if (!head) throw Error("First beacon node has no head block");
    const waitForSynced = waitForEvent<phase0.SignedBeaconBlock>(bn2.chain.emitter, ChainEvent.block, 100000, (block) =>
      ssz.phase0.SignedBeaconBlock.equals(block, head)
    );

    await connect(bn2.network as Network, bn.network.peerId, bn.network.localMultiaddrs);

    await bn2.api.beacon.publishBlock(head).catch((e) => {
      if (e instanceof BlockError && e.type.code === BlockErrorCode.PARENT_UNKNOWN) {
        // Expected
      } else {
        throw e;
      }
    });

    // Wait for NODE-A head to be processed in NODE-B without range sync
    await waitForSynced;

    await bn2.close();
    await Promise.all(validators.map((v) => v.stop()));
    await bn.close();
  });
});
