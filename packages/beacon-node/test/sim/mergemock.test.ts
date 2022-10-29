import fs from "node:fs";
import {Context} from "mocha";
import {fromHexString} from "@chainsafe/ssz";
import {isExecutionStateType, isMergeTransitionComplete} from "@lodestar/state-transition";
import {LogLevel, sleep, TimestampFormatCode} from "@lodestar/utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {IChainConfig} from "@lodestar/config";
import {Epoch} from "@lodestar/types";
import {ValidatorProposerConfig} from "@lodestar/validator";

import {ExecutePayloadStatus} from "../../src/execution/engine/interface.js";
import {ExecutionEngineHttp} from "../../src/execution/engine/http.js";
import {ChainEvent} from "../../src/chain/index.js";
import {testLogger, TestLoggerOpts} from "../utils/logger.js";
import {getDevBeaconNode} from "../utils/node/beacon.js";
import {BeaconRestApiServerOpts} from "../../src/api/index.js";
import {simTestInfoTracker} from "../utils/node/simTest.js";
import {getAndInitDevValidators} from "../utils/node/validator.js";
import {Eth1Provider} from "../../src/index.js";
import {ZERO_HASH} from "../../src/constants/index.js";
import {bytesToData, dataToBytes, quantityToNum} from "../../src/eth1/provider/utils.js";
import {defaultExecutionEngineHttpOpts} from "../../src/execution/engine/http.js";
import {runEL, ELStartMode, ELClient, sendTransaction, getBalance} from "../utils/runEl.js";
import {logFilesDir} from "./params.js";
import {shell} from "./shell.js";

// NOTE: Must specify
// EL_BINARY_DIR: File path to locate the EL executable
// EL_SCRIPT_DIR: Directory in packages/beacon-node for the EL client, from where to
// execute post-merge/pre-merge EL scenario scripts
// ETH_PORT: EL port on localhost hosting non auth protected eth_ methods
// ENGINE_PORT: Specify the port on which an jwt auth protected engine api is being hosted,
//   typically by default at 8551 for geth. Some ELs could host it as same port as eth_ apis,
//   but just with the engine_ methods protected. In that case this param can be skipped
// TX_SCENARIOS: comma seprated transaction scenarios this EL client build supports
// Example:
// ```
// $ EL_BINARY_DIR=/home/lion/Code/eth2.0/merge-interop/go-ethereum/build/bin \
//   EL_SCRIPT_DIR=geth ETH_PORT=8545 ENGINE_PORT=8551 TX_SCENARIOS=simple \
//   ../../node_modules/.bin/mocha test/sim/merge.test.ts
// ```

/* eslint-disable no-console, @typescript-eslint/naming-convention, quotes */

// BELLATRIX_EPOCH will happen at 2 sec * 8 slots = 16 sec
// 10 ttd / 2 difficulty per block = 5 blocks * 5 sec = 25 sec
const terminalTotalDifficultyPreMerge = 10;
const TX_SCENARIOS = process.env.TX_SCENARIOS?.split(",") || [];
const jwtSecretHex = "0xdc6457099f127cf0bac78de8b297df04951281909db4f58b43def7c7151e765d";
const retryAttempts = defaultExecutionEngineHttpOpts.retryAttempts;
const retryDelay = defaultExecutionEngineHttpOpts.retryDelay;

describe("executionEngine / ExecutionEngineHttp", function () {
  if (!process.env.EL_BINARY_DIR || !process.env.EL_SCRIPT_DIR) {
    throw Error(
      `EL ENV must be provided, EL_BINARY_DIR: ${process.env.EL_BINARY_DIR}, EL_SCRIPT_DIR: ${process.env.EL_SCRIPT_DIR}`
    );
  }
  this.timeout("10min");

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
  after(async () => {
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

  it("Post-merge, run for a few blocks", async function () {
    console.log("\n\nPost-merge, run for a few blocks\n\n");
    const {elClient, tearDownCallBack} = await runEL(
      {...elSetupConfig, mode: ELStartMode.PostMerge},
      {...elRunOptions, ttd: BigInt(0)},
      controller.signal
    );
    afterEachCallbacks.push(() => tearDownCallBack());

    await runNodeWithEL.bind(this)({
      elClient,
      bellatrixEpoch: 0,
      testName: "post-merge",
    });
  });


  async function runNodeWithEL(
    this: Context,
    {elClient, bellatrixEpoch, testName}: {elClient: ELClient; bellatrixEpoch: Epoch; testName: string}
  ): Promise<void> {
    const {genesisBlockHash, ttd, engineRpcUrl, ethRpcUrl} = elClient;
    const validatorClientCount = 1;
    const validatorsPerClient = 32;
    const event = ChainEvent.finalized;

    const testParams: Pick<IChainConfig, "SECONDS_PER_SLOT"> = {
      SECONDS_PER_SLOT: 2,
    };

    // Should reach justification in 6 epochs max.
    // Merge block happens at epoch 2 slot 4. Then 4 epochs to finalize
    const expectedEpochsToFinish = 6;
    // 1 epoch of margin of error
    const epochsOfMargin = 1;
    const timeoutSetupMargin = 30 * 1000; // Give extra 30 seconds of margin

    // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
    const genesisSlotsDelay = 8;

    const timeout =
      ((epochsOfMargin + expectedEpochsToFinish) * SLOTS_PER_EPOCH + genesisSlotsDelay) *
      testParams.SECONDS_PER_SLOT *
      1000;

    this.timeout(timeout + 2 * timeoutSetupMargin);

    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * testParams.SECONDS_PER_SLOT;

    const testLoggerOpts: TestLoggerOpts = {
      logLevel: LogLevel.info,
      logFile: `${logFilesDir}/mergemock-${testName}.log`,
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
        executionBuilder:{enabled: true,issueLocalFcUForBlockProduction: true},
        chain: {suggestedFeeRecipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
      },
      validatorCount: validatorClientCount * validatorsPerClient,
      logger: loggerNodeA,
      genesisTime,
      eth1BlockHash: fromHexString(genesisBlockHash),
    });
    if(!bn.chain.executionBuilder){
      throw Error("executionBuilder should have been initialized");
    }
    // Enable builder by default, else because of circuit breaker we always start it with disabled
    bn.chain.executionBuilder.updateStatus(true);

    afterEachCallbacks.push(async function () {
      await bn.close();
      await sleep(1000);
    });

    const stopInfoTracker = simTestInfoTracker(bn, loggerNodeA);
    const valProposerConfig = {
      defaultConfig: {
        graffiti: "default graffiti",
        strictFeeRecipientCheck: true,
        feeRecipient: "0xcccccccccccccccccccccccccccccccccccccccc",
        builder: {
          enabled: true,
          gasLimit: 30000000,
        },
      },
    } as ValidatorProposerConfig;

    const {validators} = await getAndInitDevValidators({
      node: bn,
      validatorsPerClient,
      validatorClientCount,
      startIndex: 0,
      // At least one sim test must use the REST API for beacon <-> validator comms
      useRestApi: true,
      testLoggerOpts,
      valProposerConfig,
    });

    afterEachCallbacks.push(async function () {
      await Promise.all(validators.map((v) => v.close()));
    });

    if (TX_SCENARIOS.includes("simple")) {
      // If bellatrixEpoch > 0, this is the case of pre-merge transaction submission on EL pow
      await sendTransaction(ethRpcUrl, {
        from: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
        to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        gas: "0x76c0",
        gasPrice: "0x9184e72a000",
        value: "0x9184e72a",
      });
    }

    await new Promise<void>((resolve, reject) => {
      bn.chain.emitter.on(ChainEvent.clockEpoch, (epoch) => {

        // Resolve only if the finalized checkpoint includes execution payload
        if (epoch>0) {
          console.log(`\nGot event ${ChainEvent.clockEpoch}, stopping validators and nodes\n`);
          resolve();
        }
      });
    });

    // Stop chain and un-subscribe events so the execution engine won't update it's head
    // Allow some time to broadcast finalized events and complete the importBlock routine
    await Promise.all(validators.map((v) => v.close()));
    await bn.close();
    await sleep(500);

    if (bn.chain.beaconProposerCache.get(1) !== "0xcccccccccccccccccccccccccccccccccccccccc") {
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

    // wait for 1 slot to print current epoch stats
    await sleep(1 * bn.config.SECONDS_PER_SLOT * 1000);
    stopInfoTracker();
    console.log("\n\nDone\n\n");
  }
});
