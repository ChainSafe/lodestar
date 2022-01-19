import {expect} from "chai";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {ssz} from "@chainsafe/lodestar-types";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {TimestampFormatCode} from "@chainsafe/lodestar-utils";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {Lightclient} from "@chainsafe/lodestar-light-client";
import {IProtoBlock} from "@chainsafe/lodestar-fork-choice";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {testLogger, LogLevel, TestLoggerOpts} from "../../utils/logger";
import {getDevBeaconNode} from "../../utils/node/beacon";
import {getAndInitDevValidators} from "../../utils/node/validator";
import {ChainEvent} from "../../../src/chain";

describe("chain / lightclient", function () {
  /**
   * Max distance between beacon node head and lightclient head
   * If SECONDS_PER_SLOT === 1, there should be some margin for slow blocks,
   * 4 = 4 sec should be good enough.
   */
  const maxLcHeadTrackingDiffSlots = 4;
  const validatorCount = 8;
  const targetSyncCommittee = 3;
  /** N sync committee periods + 1 epoch of margin */
  const finalizedEpochToReach = targetSyncCommittee * EPOCHS_PER_SYNC_COMMITTEE_PERIOD + 1;
  /** Given 100% participation the fastest epoch to reach finalization is +2 epochs. -1 for margin */
  const targetSlotToReach = computeStartSlotAtEpoch(finalizedEpochToReach + 2) - 1;
  const restPort = 9000;

  const testParams: Pick<IChainConfig, "SECONDS_PER_SLOT" | "ALTAIR_FORK_EPOCH"> = {
    /* eslint-disable @typescript-eslint/naming-convention */
    SECONDS_PER_SLOT: 1,
    ALTAIR_FORK_EPOCH: 0,
  };

  // Sometimes the machine may slow down and the lightclient head is too old.
  // This is a rare event, with maxLcHeadTrackingDiffSlots = 4, SECONDS_PER_SLOT = 1
  this.retries(2);

  it("Lightclient track head on server configuration", async function () {
    this.timeout("10 min");

    // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
    const genesisSlotsDelay = 2 / testParams.SECONDS_PER_SLOT;
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

    const loggerNodeA = testLogger("Node", testLoggerOpts);
    const loggerLC = testLogger("LC", {...testLoggerOpts, logLevel: LogLevel.debug});

    const bn = await getDevBeaconNode({
      params: testParams,
      options: {
        sync: {isSingleNode: true},
        api: {rest: {enabled: true, api: ["lightclient"], port: restPort}},
      },
      validatorCount,
      genesisTime,
      logger: loggerNodeA,
    });
    const {validators} = await getAndInitDevValidators({
      node: bn,
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts: {...testLoggerOpts, logLevel: LogLevel.error},
    });

    await Promise.all(validators.map((validator) => validator.start()));

    // This promise chain does:
    // 1. Wait for the beacon node to emit one head that has a snapshot associated to it
    // 2. Initialize lightclient from that head block root
    // 3. Start lightclient to track head
    // 4. On every new beacon node head, check that the lightclient is following closely
    //   - If too far behind error the test
    //   - If beacon node reaches the finality slot, resolve test
    const promiseUntilHead = new Promise<IProtoBlock>((resolve) => {
      bn.chain.emitter.on(ChainEvent.forkChoiceHead, async (head) => {
        // Wait for the second slot so syncCommitteeWitness is available
        if (head.slot > 2) {
          resolve(head);
        }
      });
    }).then(async (head) => {
      // Initialize lightclient
      loggerLC.important("Initializing lightclient", {slot: head.slot});

      const lightclient = await Lightclient.initializeFromCheckpointRoot({
        config: bn.config,
        logger: loggerLC,
        beaconApiUrl: `http://localhost:${restPort}`,
        genesisData: {
          genesisTime: bn.chain.genesisTime,
          genesisValidatorsRoot: bn.chain.genesisValidatorsRoot as Uint8Array,
        },
        checkpointRoot: fromHexString(head.blockRoot),
      });

      loggerLC.important("Initialized lightclient", {headSlot: lightclient.getHead().slot});
      lightclient.start();

      return new Promise<void>((resolve, reject) => {
        bn.chain.emitter.on(ChainEvent.forkChoiceHead, async (head) => {
          try {
            // Test fetching proofs
            const {proof, header} = await lightclient.getHeadStateProof([["latestBlockHeader", "bodyRoot"]]);
            const stateRootHex = toHexString(header.stateRoot);
            const lcHeadState = bn.chain.stateCache.get(stateRootHex);
            if (!lcHeadState) {
              throw Error(`LC head state not in cache ${stateRootHex}`);
            }

            const stateLcFromProof = ssz.altair.BeaconState.createTreeBackedFromProof(
              header.stateRoot as Uint8Array,
              proof
            );
            expect(toHexString(stateLcFromProof.latestBlockHeader.bodyRoot)).to.equal(
              toHexString(lcHeadState.latestBlockHeader.bodyRoot),
              `Recovered 'latestBlockHeader.bodyRoot' from state ${stateRootHex} not correct`
            );

            // Stop test if reached target head slot
            const lcHeadSlot = lightclient.getHead().slot;
            if (head.slot - lcHeadSlot > maxLcHeadTrackingDiffSlots) {
              throw Error(`Lightclient head ${lcHeadSlot} is too far behind the beacon node ${head.slot}`);
            } else if (head.slot > targetSlotToReach) {
              resolve();
            }
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    const promiseTillFinalization = new Promise<void>((resolve) => {
      bn.chain.emitter.on(ChainEvent.finalized, (checkpoint) => {
        loggerNodeA.important("Node A emitted finalized checkpoint event", {epoch: checkpoint.epoch});
        if (checkpoint.epoch >= finalizedEpochToReach) {
          resolve();
        }
      });
    });

    await Promise.all([promiseUntilHead, promiseTillFinalization]);

    const headSummary = bn.chain.forkChoice.getHead();
    const head = await bn.db.block.get(fromHexString(headSummary.blockRoot));
    if (!head) throw Error("First beacon node has no head block");

    await Promise.all(validators.map((v) => v.stop()));
    await bn.close();
  });
});
