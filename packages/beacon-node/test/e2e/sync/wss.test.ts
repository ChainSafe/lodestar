import {GENESIS_SLOT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {phase0, Slot} from "@lodestar/types";
import {IChainConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {TimestampFormatCode} from "@lodestar/utils";
import {fetchWeakSubjectivityState} from "../../../../cli/src/networks/index.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";
import {ChainEvent} from "../../../src/chain/index.js";
import {BeaconRestApiServerOpts} from "../../../src/api/rest/index.js";
import {testLogger, TestLoggerOpts} from "../../utils/logger.js";
import {connect} from "../../utils/network.js";
import {BackfillSyncEvent} from "../../../src/sync/backfill/index.js";

/* eslint-disable @typescript-eslint/naming-convention */
describe("Start from WSS", function () {
  const testParams: Pick<IChainConfig, "SECONDS_PER_SLOT"> = {
    SECONDS_PER_SLOT: 2,
  };

  const afterEachCallbacks: (() => Promise<unknown> | unknown)[] = [];
  afterEach(async () => Promise.all(afterEachCallbacks.splice(0, afterEachCallbacks.length)));

  it("using another node", async function () {
    // Should reach justification in 3 epochs max, and finalization in 4 epochs max
    const expectedEpochsToFinish = 4;
    // 1 epoch of margin of error
    const epochsOfMargin = 1;
    const timeoutSetupMargin = 5 * 1000; // Give extra 5 seconds of margin

    // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
    const genesisSlotsDelay = 16;

    const timeout =
      ((epochsOfMargin + expectedEpochsToFinish) * SLOTS_PER_EPOCH + genesisSlotsDelay) *
      testParams.SECONDS_PER_SLOT *
      1000;

    this.timeout(timeout + 2 * timeoutSetupMargin);

    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * testParams.SECONDS_PER_SLOT;

    const testLoggerOpts: TestLoggerOpts = {
      timestampFormat: {
        format: TimestampFormatCode.EpochSlot,
        genesisTime: genesisTime,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        secondsPerSlot: testParams.SECONDS_PER_SLOT,
      },
    };
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);
    const loggerNodeB = testLogger("Node-B", testLoggerOpts);

    const bn = await getDevBeaconNode({
      params: {...testParams, ALTAIR_FORK_EPOCH: Infinity},
      options: {
        api: {
          rest: {enabled: true, api: ["debug"]} as BeaconRestApiServerOpts,
        },
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true},
        chain: {blsVerifyAllMainThread: true},
      },
      validatorCount: 32,
      logger: loggerNodeA,
      genesisTime,
    });
    afterEachCallbacks.push(() => bn.close());

    const finalizedEventistener = waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.finalized, timeout);
    const {validators} = await getAndInitDevValidators({
      node: bn,
      validatorsPerClient: 32,
      validatorClientCount: 1,
      startIndex: 0,
      // At least one sim test must use the REST API for beacon <-> validator comms
      useRestApi: true,
      testLoggerOpts,
    });

    afterEachCallbacks.push(() => Promise.all(validators.map((v) => v.close())));

    try {
      await finalizedEventistener;
      await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.finalized, timeout);
      loggerNodeA.info("\n\nNode A finalized\n\n");
    } catch (e) {
      (e as Error).message = `Node A failed to finalize: ${(e as Error).message}`;
      throw e;
    }

    const checkpointSyncUrl = "http://127.0.0.1:19596";
    loggerNodeB.info("Fetching weak subjectivity state ", {checkpointSyncUrl});
    const {wsState, wsCheckpoint} = await fetchWeakSubjectivityState(config, loggerNodeB, {checkpointSyncUrl});
    loggerNodeB.info("Fetched wss state");

    const bnStartingFromWSS = await getDevBeaconNode({
      params: {...testParams, ALTAIR_FORK_EPOCH: Infinity},
      options: {
        api: {rest: {enabled: true, port: 9587} as BeaconRestApiServerOpts},
        sync: {isSingleNode: true, backfillBatchSize: 64},
        chain: {blsVerifyAllMainThread: true},
      },
      validatorCount: 32,
      logger: loggerNodeB,
      genesisTime,
      anchorState: wsState,
      wsCheckpoint,
    });
    afterEachCallbacks.push(() => bnStartingFromWSS.close());

    const head = bn.chain.forkChoice.getHead();
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (!head) throw Error("First beacon node has no head block");
    if (!bnStartingFromWSS.backfillSync) throw Error("Backfill sync not started");
    const waitForSynced = waitForEvent<Slot>(
      bnStartingFromWSS.backfillSync,
      BackfillSyncEvent.completed,
      100000,
      (slot) => slot == GENESIS_SLOT
    );

    await connect(bnStartingFromWSS.network, bn.network.peerId, bn.network.localMultiaddrs);

    await waitForSynced;
  });
});
