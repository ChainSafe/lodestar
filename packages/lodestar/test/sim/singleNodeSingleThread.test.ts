import {expect} from "chai";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {config as minimalConfig} from "@chainsafe/lodestar-config/default";
import {merge, phase0} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {getDevBeaconNode} from "../utils/node/beacon";
import {waitForEvent} from "../utils/events/resolver";
import {getAndInitDevValidators} from "../utils/node/validator";
import {ChainEvent} from "../../src/chain";
import {RestApiOptions} from "../../src/api/rest";
import {testLogger, TestLoggerOpts, LogLevel} from "../utils/logger";
import {logFilesDir} from "./params";
import {simTestInfoTracker} from "../utils/node/simTest";
import {sleep, TimestampFormatCode} from "@chainsafe/lodestar-utils";
import {initBLS} from "@chainsafe/lodestar-cli/src/util";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {INTEROP_BLOCK_HASH} from "../../src/node/utils/interop/state";

/* eslint-disable no-console, @typescript-eslint/naming-convention */

describe("Run single node single thread interop validators (no eth1) until checkpoint", function () {
  const testParams: Pick<IChainConfig, "SECONDS_PER_SLOT"> = {
    SECONDS_PER_SLOT: 2,
  };

  before(async function () {
    await initBLS();
  });

  const validatorClientCount = 1;
  const validatorsPerClient = 32;

  type MergeOption = {
    ttd: number;
    mergeBlockDifficulty: number;
    startDifficulty: number;
    difficultyIncrement: number;
  };

  type TestTypeWithOptions = ({testType: "merge"} & MergeOption) | {testType: "phase0"} | {testType: "altair"};

  const testCases: ({
    event: ChainEvent.justified | ChainEvent.finalized;
    altairEpoch: number;
    mergeEpoch: number;
  } & TestTypeWithOptions)[] = [
    // phase0 fork only
    {testType: "phase0", event: ChainEvent.finalized, altairEpoch: Infinity, mergeEpoch: Infinity},
    // altair fork only
    {testType: "altair", event: ChainEvent.finalized, altairEpoch: 0, mergeEpoch: Infinity},
    // altair fork at epoch 2
    {testType: "altair", event: ChainEvent.finalized, altairEpoch: 2, mergeEpoch: Infinity},
    // merge fork at epoch 0, testType is quite confusing as we don't need ttd params, genesis state automatically mark "isMergeCompleted"
    // hence no need to detect merge block in this test case
    {testType: "altair", event: ChainEvent.finalized, altairEpoch: 0, mergeEpoch: 0},
    // eth1 difficulty of blocks is 0 => -1; 1 => 1; 2 => 3; ...
    // mergeBlock is block 1 since ttd = 0
    // merge block is genesis block of execution mock => 1st block included is 1 at block 8
    {
      event: ChainEvent.finalized,
      altairEpoch: 0,
      mergeEpoch: 1,
      testType: "merge",
      ttd: 0,
      mergeBlockDifficulty: 1,
      startDifficulty: -1,
      difficultyIncrement: 2,
    },
    // same to the above test with ttd 10, startDifficulty 0, mergeEpoch 2, altairEpoch 1
    {
      event: ChainEvent.finalized,
      altairEpoch: 1,
      mergeEpoch: 2,
      testType: "merge",
      ttd: 10,
      mergeBlockDifficulty: 10,
      startDifficulty: 0,
      difficultyIncrement: 2,
    },
  ];

  for (const testCase of testCases) {
    const {event, altairEpoch, mergeEpoch, testType} = testCase;
    it(`singleNode ${validatorClientCount} vc / ${validatorsPerClient} validator > until ${event}, altair ${altairEpoch} merge ${mergeEpoch}`, async function () {
      // Should reach justification in 3 epochs max, and finalization in 4 epochs max
      const expectedEpochsToFinish = event === ChainEvent.justified ? 3 : 4;
      // 1 epoch of margin of error
      const epochsOfMargin = 1;
      const timeoutSetupMargin = 5 * 1000; // Give extra 5 seconds of margin

      // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
      const genesisSlotsDelay = 3;

      const timeout =
        ((epochsOfMargin + expectedEpochsToFinish) * SLOTS_PER_EPOCH + genesisSlotsDelay) *
        testParams.SECONDS_PER_SLOT *
        1000;

      this.timeout(timeout + 2 * timeoutSetupMargin);

      const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * testParams.SECONDS_PER_SLOT;

      const testLoggerOpts: TestLoggerOpts = {
        logLevel: LogLevel.info,
        logFile: `${logFilesDir}/singlethread_singlenode_altair-${altairEpoch}_merge-${mergeEpoch}_vc-${validatorClientCount}_vs-${validatorsPerClient}_event-${event}.log`,
        timestampFormat: {
          format: TimestampFormatCode.EpochSlot,
          genesisTime,
          slotsPerEpoch: SLOTS_PER_EPOCH,
          secondsPerSlot: testParams.SECONDS_PER_SLOT,
        },
      };
      const loggerNodeA = testLogger("Node-A", testLoggerOpts);

      const genesisBlockHash = toHexString(INTEROP_BLOCK_HASH);
      const bn = await getDevBeaconNode({
        params: {
          ...testParams,
          ALTAIR_FORK_EPOCH: altairEpoch,
          MERGE_FORK_EPOCH: mergeEpoch,
          SECONDS_PER_ETH1_BLOCK: 2,
          TERMINAL_TOTAL_DIFFICULTY:
            testType === "merge" ? BigInt(testCase.ttd) : minimalConfig.TERMINAL_TOTAL_DIFFICULTY,
        },
        options: {
          api: {rest: {enabled: true} as RestApiOptions},
          sync: {isSingleNode: true},
          executionEngine: {mode: "mock", genesisBlockHash},
          eth1:
            testType === "merge"
              ? {
                  mode: "mock",
                  startDifficulty: testCase.startDifficulty,
                  difficultyIncrement: testCase.difficultyIncrement,
                  disableEth1DepositDataTracker: true,
                  mergeBlockDifficulty: testCase.mergeBlockDifficulty,
                  mergeBlockHash: genesisBlockHash,
                }
              : {mode: "disabled"},
        },
        validatorCount: validatorClientCount * validatorsPerClient,
        logger: loggerNodeA,
        genesisTime,
      });

      const stopInfoTracker = simTestInfoTracker(bn, loggerNodeA);

      const justificationEventListener = waitForEvent<phase0.Checkpoint>(bn.chain.emitter, event, timeout);
      const validators = await getAndInitDevValidators({
        node: bn,
        validatorsPerClient,
        validatorClientCount,
        startIndex: 0,
        // At least one sim test must use the REST API for beacon <-> validator comms
        useRestApi: true,
        testLoggerOpts,
      });

      await Promise.all(validators.map((v) => v.start()));

      if (testType === "merge") {
        // wait for merge block first
        await waitForEvent<merge.SignedBeaconBlock>(
          bn.chain.emitter,
          ChainEvent.block,
          timeout,
          (signedBlock: merge.SignedBeaconBlock) => {
            if (
              !signedBlock.message.body.executionPayload ||
              signedBlock.message.body.executionPayload.blockNumber === 0
            ) {
              // when mergeBlock is not found, blockNumber in executionPayload is always 0
              return false;
            } else {
              // ExecutionEngineMock: 1st pow block to be included in executionPayload always have blockNumber 1
              const slotDelta = testCase.mergeEpoch * SLOTS_PER_EPOCH - 1;
              expect(signedBlock.message.body.executionPayload.blockNumber).to.be.equal(
                signedBlock.message.slot - slotDelta,
                "incorrect payload block number"
              );
              return true;
            }
          }
        );
        // confirm merge block
        const mergeBlockRoot = bn.chain.eth1.getPowBlockAtTotalDifficulty();
        if (!mergeBlockRoot) throw Error("merge block root not found");
        const mergeBlock = await bn.chain.eth1.getPowBlock(toHexString(mergeBlockRoot));
        if (!mergeBlock) throw Error("merge block not found");
        expect(Number(mergeBlock.totalDifficulty)).to.be.equal(
          testCase.mergeBlockDifficulty,
          "merge block totalDifficulty is not correct"
        );
        expect(mergeBlock.blockhash).to.be.equal(genesisBlockHash, "merge block hash is not correct");
        expect(mergeBlock.number).to.be.equal(
          Math.ceil((testCase.mergeBlockDifficulty - testCase.startDifficulty) / testCase.difficultyIncrement),
          "merge block number is not correct"
        );
      }

      try {
        await justificationEventListener;
        console.log(`\nGot event ${event}, stopping validators and nodes\n`);
      } catch (e) {
        (e as Error).message = `failed to get event: ${event}: ${(e as Error).message}`;
        throw e;
      } finally {
        await Promise.all(validators.map((v) => v.stop()));

        // wait for 1 slot
        await sleep(1 * bn.config.SECONDS_PER_SLOT * 1000);
        stopInfoTracker();
        await bn.close();
        console.log("\n\nDone\n\n");
        await sleep(1000);
      }
    });
  }
});
