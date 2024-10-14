import fs from "node:fs";
import {describe, it, afterAll, afterEach, vi} from "vitest";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {LogLevel, sleep} from "@lodestar/utils";
import {TimestampFormatCode} from "@lodestar/logger";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ChainConfig} from "@lodestar/config";
import {Epoch, SignedBeaconBlock, bellatrix} from "@lodestar/types";
import {ValidatorProposerConfig} from "@lodestar/validator";
import {routes} from "@lodestar/api";

import {ClockEvent} from "../../src/util/clock.js";
import {testLogger, TestLoggerOpts} from "../utils/logger.js";
import {getDevBeaconNode} from "../utils/node/beacon.js";
import {BeaconRestApiServerOpts} from "../../src/api/index.js";
import {simTestInfoTracker} from "../utils/node/simTest.js";
import {getAndInitDevValidators} from "../utils/node/validator.js";
import {Eth1Provider} from "../../src/index.js";
import {ZERO_HASH} from "../../src/constants/index.js";
import {runEL, ELStartMode, ELClient} from "../utils/runEl.js";
import {logFilesDir} from "./params.js";
import {shell} from "./shell.js";

// NOTE: How to run
// EL_BINARY_DIR=g11tech/mergemock:latest EL_SCRIPT_DIR=mergemock LODESTAR_PRESET=mainnet ETH_PORT=8661 ENGINE_PORT=8551 yarn vitest --run test/sim/mergemock.test.ts
// ```

/* eslint-disable no-console, @typescript-eslint/naming-convention */

const jwtSecretHex = "0xdc6457099f127cf0bac78de8b297df04951281909db4f58b43def7c7151e765d";

describe("executionEngine / ExecutionEngineHttp", () => {
  if (!process.env.EL_BINARY_DIR || !process.env.EL_SCRIPT_DIR) {
    throw Error(
      `EL ENV must be provided, EL_BINARY_DIR: ${process.env.EL_BINARY_DIR}, EL_SCRIPT_DIR: ${process.env.EL_SCRIPT_DIR}`
    );
  }
  vi.setConfig({testTimeout: 10 * 60 * 1000});

  const dataPath = fs.mkdtempSync("lodestar-test-mergemock");
  const elSetupConfig = {
    elScriptDir: process.env.EL_SCRIPT_DIR,
    elBinaryDir: process.env.EL_BINARY_DIR,
  };
  const elRunOptions = {
    dataPath,
    jwtSecretHex,
    enginePort: parseInt(process.env.ENGINE_PORT ?? "8551"),
    ethPort: parseInt(process.env.ETH_PORT ?? "8545"),
  };

  const controller = new AbortController();
  afterAll(async () => {
    controller?.abort();
    await shell(`sudo rm -rf ${dataPath}`);
  });

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  for (const useProduceBlockV3 of [false, true]) {
    it(`Test builder with useProduceBlockV3=${useProduceBlockV3}`, async () => {
      console.log("\n\nPost-merge, run for a few blocks\n\n");
      const {elClient, tearDownCallBack} = await runEL(
        {...elSetupConfig, mode: ELStartMode.PostMerge},
        {...elRunOptions, ttd: BigInt(0)},
        controller.signal
      );
      afterEachCallbacks.push(() => tearDownCallBack());

      await runNodeWithEL({
        elClient,
        bellatrixEpoch: 0,
        testName: "post-merge",
        useProduceBlockV3,
      });
    });
  }

  type RunOpts = {elClient: ELClient; bellatrixEpoch: Epoch; testName: string; useProduceBlockV3: boolean};

  async function runNodeWithEL({elClient, bellatrixEpoch, testName, useProduceBlockV3}: RunOpts): Promise<void> {
    const {genesisBlockHash, ttd, engineRpcUrl, ethRpcUrl} = elClient;
    const validatorClientCount = 1;
    const validatorsPerClient = 32;

    const testParams: Pick<ChainConfig, "SECONDS_PER_SLOT"> = {
      SECONDS_PER_SLOT: 2,
    };

    // Should reach justification in 6 epochs max.
    // Merge block happens at epoch 2 slot 4. Then 4 epochs to finalize
    const expectedEpochsToFinish = 1;
    // 1 epoch of margin of error
    const epochsOfMargin = 1;
    const timeoutSetupMargin = 30 * 1000; // Give extra 30 seconds of margin

    // The builder gets activated post middle of epoch because of circuit breaker
    // In a perfect run expected builder = 16, expected engine = 16
    //   keeping 4 missed slots margin for both
    const expectedBuilderBlocks = 12;
    const expectedEngineBlocks = 12;

    // All assertions are tracked w.r.t. fee recipient by attaching different fee recipient to
    // execution and builder
    const feeRecipientLocal = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const feeRecipientEngine = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const feeRecipientMevBoost = "0xcccccccccccccccccccccccccccccccccccccccc";

    // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
    const genesisSlotsDelay = 8;

    const timeout =
      ((epochsOfMargin + expectedEpochsToFinish) * SLOTS_PER_EPOCH + genesisSlotsDelay) *
      testParams.SECONDS_PER_SLOT *
      1000;

    vi.setConfig({testTimeout: timeout + 2 * timeoutSetupMargin});

    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * testParams.SECONDS_PER_SLOT;

    const testLoggerOpts: TestLoggerOpts = {
      level: LogLevel.info,
      file: {
        filepath: `${logFilesDir}/mergemock-${testName}.log`,
        level: LogLevel.debug,
      },
      timestampFormat: {
        format: TimestampFormatCode.EpochSlot,
        genesisTime,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        secondsPerSlot: testParams.SECONDS_PER_SLOT,
      },
    };
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);

    const bn = await getDevBeaconNode({
      params: {
        ...testParams,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: bellatrixEpoch,
        TERMINAL_TOTAL_DIFFICULTY: ttd,
      },
      options: {
        api: {rest: {enabled: true} as BeaconRestApiServerOpts},
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true, discv5: null},
        // Now eth deposit/merge tracker methods directly available on engine endpoints
        eth1: {enabled: false, providerUrls: [engineRpcUrl], jwtSecretHex},
        executionEngine: {urls: [engineRpcUrl], jwtSecretHex},
        executionBuilder: {
          url: ethRpcUrl,
          enabled: true,
          issueLocalFcUWithFeeRecipient: feeRecipientMevBoost,
          allowedFaults: 16,
          faultInspectionWindow: 32,
        },
        chain: {suggestedFeeRecipient: feeRecipientLocal},
      },
      validatorCount: validatorClientCount * validatorsPerClient,
      logger: loggerNodeA,
      genesisTime,
      eth1BlockHash: fromHexString(genesisBlockHash),
    });
    if (!bn.chain.executionBuilder) {
      throw Error("executionBuilder should have been initialized");
    }
    // Enable builder by default, else because of circuit breaker we always start it with disabled
    bn.chain.executionBuilder.updateStatus(true);

    afterEachCallbacks.push(async () => {
      await bn.close();
      await sleep(1000);
    });

    const stopInfoTracker = simTestInfoTracker(bn, loggerNodeA);
    const valProposerConfig = {
      defaultConfig: {
        graffiti: "default graffiti",
        strictFeeRecipientCheck: true,
        feeRecipient: feeRecipientEngine,
        builder: {
          gasLimit: 30000000,
          selection: routes.validator.BuilderSelection.BuilderAlways,
        },
      },
    } as ValidatorProposerConfig;

    const {validators} = await getAndInitDevValidators({
      logPrefix: "mergemock",
      node: bn,
      validatorsPerClient,
      validatorClientCount,
      startIndex: 0,
      // At least one sim test must use the REST API for beacon <-> validator comms
      useRestApi: true,
      testLoggerOpts,
      valProposerConfig,
      useProduceBlockV3,
    });

    afterEachCallbacks.push(async () => {
      await Promise.all(validators.map((v) => v.close()));
    });

    let engineBlocks = 0;
    let builderBlocks = 0;
    await new Promise<void>((resolve, _reject) => {
      bn.chain.emitter.on(routes.events.EventType.block, async (blockData) => {
        const {data: fullOrBlindedBlock} = (await bn.api.beacon.getBlockV2({blockId: blockData.block})) as {
          data: SignedBeaconBlock;
        };
        if (fullOrBlindedBlock !== undefined) {
          const blockFeeRecipient = toHexString(
            (fullOrBlindedBlock as bellatrix.SignedBeaconBlock).message.body.executionPayload.feeRecipient
          );
          if (blockFeeRecipient === feeRecipientMevBoost) {
            builderBlocks++;
          } else {
            engineBlocks++;
          }
        }
      });
      bn.chain.clock.on(ClockEvent.epoch, (epoch) => {
        // Resolve only if the finalized checkpoint includes execution payload
        if (epoch >= expectedEpochsToFinish) {
          console.log("\nGot event epoch, stopping validators and nodes\n");
          resolve();
        }
      });
    });

    // Stop chain and un-subscribe events so the execution engine won't update it's head
    // Allow some time to broadcast finalized events and complete the importBlock routine
    await Promise.all(validators.map((v) => v.close()));
    await bn.close();
    await sleep(500);

    if (bn.chain.beaconProposerCache.get(1) !== feeRecipientEngine) {
      throw Error("Invalid feeRecipient set at BN");
    }

    // Assertions to make sure the end state is good
    // 1. The proper head is set
    const rpc = new Eth1Provider({DEPOSIT_CONTRACT_ADDRESS: ZERO_HASH}, {providerUrls: [engineRpcUrl], jwtSecretHex});
    const consensusHead = bn.chain.forkChoice.getHead();
    const executionHeadBlock = await rpc.getBlockByNumber("latest");

    if (!executionHeadBlock) throw Error("Execution has not head block");
    if (consensusHead.executionPayloadBlockHash !== executionHeadBlock.hash) {
      throw Error(
        "Consensus head not equal to execution head: " +
          JSON.stringify({
            executionHeadBlockHash: executionHeadBlock.hash,
            consensusHeadExecutionPayloadBlockHash: consensusHead.executionPayloadBlockHash,
            consensusHeadSlot: consensusHead.slot,
          })
      );
    }

    // 2. builder blocks are as expected
    if (builderBlocks < expectedBuilderBlocks) {
      throw Error(`Incorrect builderBlocks=${builderBlocks} (expected=${expectedBuilderBlocks})`);
    }

    // 3. engine blocks are as expected
    if (engineBlocks < expectedEngineBlocks) {
      throw Error(`Incorrect engineBlocks=${engineBlocks} (expected=${expectedEngineBlocks})`);
    }

    // wait for 1 slot to print current epoch stats
    await sleep(1 * bn.config.SECONDS_PER_SLOT * 1000);
    stopInfoTracker();
    console.log("\n\nDone\n\n");
  }
});
