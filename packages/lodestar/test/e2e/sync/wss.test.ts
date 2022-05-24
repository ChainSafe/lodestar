import {GENESIS_SLOT, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {phase0, Slot} from "@chainsafe/lodestar-types";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {fetchWeakSubjectivityState} from "../../../../cli/src/networks/index.js";
import {config} from "@chainsafe/lodestar-config/default";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";
import {ChainEvent} from "../../../src/chain/index.js";
import {RestApiOptions} from "../../../src/api/rest/index.js";
import {testLogger, TestLoggerOpts} from "../../utils/logger.js";
import {connect} from "../../utils/network.js";
import {Network} from "../../../src/network/index.js";
import {BackfillSyncEvent} from "../../../src/sync/backfill/index.js";
import {TimestampFormatCode} from "@chainsafe/lodestar-utils";

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
          rest: {enabled: true, api: ["debug"]} as RestApiOptions,
        },
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true},
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

    afterEachCallbacks.push(() => Promise.all(validators.map((v) => v.stop())));
    await Promise.all(validators.map((v) => v.start()));

    try {
      await finalizedEventistener;
      await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.finalized, timeout);
      loggerNodeA.important("\n\nNode A finalized\n\n");
    } catch (e) {
      (e as Error).message = `Node A failed to finalize: ${(e as Error).message}`;
      throw e;
    }

    const weakSubjectivityServerUrl = "http://127.0.0.1:19596";
    loggerNodeB.important("Fetching weak subjectivity state ", {weakSubjectivityServerUrl});
    const {wsState, wsCheckpoint} = await fetchWeakSubjectivityState(config, {weakSubjectivityServerUrl});
    loggerNodeB.important("Fetched wss state");

    const bnStartingFromWSS = await getDevBeaconNode({
      params: {...testParams, ALTAIR_FORK_EPOCH: Infinity},
      options: {
        api: {rest: {enabled: true, port: 9587} as RestApiOptions},
        sync: {isSingleNode: true, backfillBatchSize: 64},
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

    await connect(bnStartingFromWSS.network as Network, bn.network.peerId, bn.network.localMultiaddrs);

    await waitForSynced;
  });
});
