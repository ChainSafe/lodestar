import {expect} from "chai";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {IChainConfig} from "@lodestar/config";
import {TimestampFormatCode, toHex} from "@lodestar/utils";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";
import {ChainEvent} from "../../../src/chain/index.js";
import {BeaconRestApiServerOpts} from "../../../src/api/rest/index.js";
import {testLogger, TestLoggerOpts} from "../../utils/logger.js";
import {connect} from "../../utils/network.js";

/* eslint-disable @typescript-eslint/naming-convention */
describe("VerifyForwardCheckpoint", function () {
  const testParams: Pick<IChainConfig, "SECONDS_PER_SLOT"> = {
    SECONDS_PER_SLOT: 2,
  };

  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  it("checks the return from VerifyForwardCheckpoint", async function () {
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
      3 *
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

    // stop bn after validators
    afterEachCallbacks.push(() => bn.close());

    let firstCP: phase0.Checkpoint;
    let forwardWSCheckpoint: phase0.Checkpoint;

    try {
      await finalizedEventistener;
      firstCP = await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.finalized, timeout);

      loggerNodeA.info(`\n\nfirst ChkPt ${toHex(firstCP.root)}:${firstCP.epoch}`);

      await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.finalized, timeout);

      forwardWSCheckpoint = await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.finalized, timeout);

      loggerNodeA.info(`\n\nthird ChkPt ${toHex(forwardWSCheckpoint.root)}:${forwardWSCheckpoint.epoch}`);
    } catch (e) {
      (e as Error).message = `Node A failed to finalize: ${(e as Error).message}`;
      throw e;
    }

    const bn2 = await getDevBeaconNode({
      params: {...testParams, ALTAIR_FORK_EPOCH: Infinity},
      options: {
        api: {rest: {enabled: false} as BeaconRestApiServerOpts},
        sync: {isSingleNode: true},
        chain: {
          blsVerifyAllMainThread: true,
          forwardWSCheckpoint: {root: forwardWSCheckpoint.root, epoch: forwardWSCheckpoint.epoch},
        },
      },
      validatorCount: 32,
      logger: loggerNodeB,
      genesisTime,
    });

    afterEachCallbacks.push(() => bn2.close());

    afterEachCallbacks.push(() => bn2.close());

    const head = bn.chain.forkChoice.getHead();
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (!head) throw Error("First beacon node has no head block");

    await connect(bn2.network, bn.network.peerId, bn.network.localMultiaddrs);

    let chekpointReturned = await waitForEvent<phase0.Checkpoint>(bn2.chain.emitter, ChainEvent.finalized, timeout);

    let forwardWSCheckpointFound = false;
    while (chekpointReturned.epoch < forwardWSCheckpoint.epoch) {
      chekpointReturned = await waitForEvent<phase0.Checkpoint>(bn2.chain.emitter, ChainEvent.finalized, timeout);

      const returnValue = bn2.chain.forkChoice.verifyForwardCheckpoint(forwardWSCheckpoint);
      if (returnValue) {
        expect(ssz.Root.equals(forwardWSCheckpoint.root, chekpointReturned.root)).to.be.true;
        expect(chekpointReturned.epoch).to.be.equal(forwardWSCheckpoint.epoch);
        forwardWSCheckpointFound = true;
      } else {
        //node has still not reached the checkpoint epoch
        expect(ssz.Root.equals(forwardWSCheckpoint.root, chekpointReturned.root)).to.be.false;
        expect(chekpointReturned.epoch).to.be.not.equal(forwardWSCheckpoint.epoch);
      }
      loggerNodeB.info("\n\nNode B finalized - ", {
        epoch: chekpointReturned.epoch,
        root: toHex(chekpointReturned.root),
      });
    }
    expect(forwardWSCheckpointFound).to.be.true;
  });
});
