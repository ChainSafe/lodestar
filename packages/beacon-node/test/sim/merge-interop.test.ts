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

  const dataPath = fs.mkdtempSync("lodestar-test-merge-interop");
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

  it("Send stub payloads to EL", async () => {
    const {elClient, tearDownCallBack} = await runEL(
      {...elSetupConfig, mode: ELStartMode.PostMerge},
      {...elRunOptions, ttd: BigInt(0)},
      controller.signal
    );
    afterEachCallbacks.push(() => tearDownCallBack());
    const {genesisBlockHash, engineRpcUrl, ethRpcUrl} = elClient;

    if (TX_SCENARIOS.includes("simple")) {
      await sendTransaction(ethRpcUrl, {
        from: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
        to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        gas: "0x76c0",
        gasPrice: "0x9184e72a000",
        value: "0x9184e72a",
      });

      const balance = await getBalance(ethRpcUrl, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      if (balance != "0x0") throw new Error("Invalid Balance: " + balance);
    }

    //const controller = new AbortController();
    const executionEngine = new ExecutionEngineHttp(
      {urls: [engineRpcUrl], jwtSecretHex, retryAttempts, retryDelay},
      {signal: controller.signal}
    );

    // 1. Prepare a payload

    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_forkchoiceUpdatedV1","params":[{"headBlockHash":"0x3b8fb240d288781d4aac94d3fd16809ee413bc99294a085798a589dae51ddd4a", "safeBlockHash":"0x3b8fb240d288781d4aac94d3fd16809ee413bc99294a085798a589dae51ddd4a", "finalizedBlockHash":"0x0000000000000000000000000000000000000000000000000000000000000000"}, {"timestamp":"0x5", "prevRandao":"0x0000000000000000000000000000000000000000000000000000000000000000", "feeRecipient":"0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b"}],"id":67}' http://localhost:8550
     **/

    const preparePayloadParams = {
      // Note: this is created with a pre-defined genesis.json
      timestamp: quantityToNum("0x5"),
      prevRandao: dataToBytes("0x0000000000000000000000000000000000000000000000000000000000000000"),
      suggestedFeeRecipient: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
    };

    const finalizedBlockHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

    const payloadId = await executionEngine.notifyForkchoiceUpdate(
      genesisBlockHash,
      //use finalizedBlockHash as safeBlockHash
      finalizedBlockHash,
      finalizedBlockHash,
      preparePayloadParams
    );

    if (!payloadId) throw Error("InvalidPayloadId");

    // 2. Get the payload
    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_getPayloadV1","params":["0xa247243752eb10b4"],"id":67}' http://localhost:8550
     **/

    const payload = await executionEngine.getPayload(payloadId);
    if (TX_SCENARIOS.includes("simple")) {
      if (payload.transactions.length !== 1)
        throw new Error("Expected a simple transaction to be in the fetched payload");
      const balance = await getBalance(ethRpcUrl, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      if (balance != "0x0") throw new Error("Invalid Balance: " + balance);
    }

    // 3. Execute the payload
    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_newPayloadV1","params":[{"parentHash":"0x3b8fb240d288781d4aac94d3fd16809ee413bc99294a085798a589dae51ddd4a","coinbase":"0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b","stateRoot":"0xca3149fa9e37db08d1cd49c9061db1002ef1cd58db2210f2115c8c989b2bdf45","receiptRoot":"0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421","logsBloom":"0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000","prevRandao":"0x0000000000000000000000000000000000000000000000000000000000000000","blockNumber":"0x1","gasLimit":"0x1c9c380","gasUsed":"0x0","timestamp":"0x5","extraData":"0x","baseFeePerGas":"0x7","blockHash":"0x3559e851470f6e7bbed1db474980683e8c315bfce99b2a6ef47c057c04de7858","transactions":[]}],"id":67}' http://localhost:8550
     **/

    const payloadResult = await executionEngine.notifyNewPayload(payload);
    if (payloadResult.status !== ExecutePayloadStatus.VALID) {
      throw Error("getPayload returned payload that notifyNewPayload deems invalid");
    }

    // 4. Update the fork choice

    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_forkchoiceUpdatedV1","params":[{"headBlockHash":"0x3559e851470f6e7bbed1db474980683e8c315bfce99b2a6ef47c057c04de7858", "safeBlockHash":"0x3559e851470f6e7bbed1db474980683e8c315bfce99b2a6ef47c057c04de7858", "finalizedBlockHash":"0x3b8fb240d288781d4aac94d3fd16809ee413bc99294a085798a589dae51ddd4a"}, null],"id":67}' http://localhost:8550
     **/

    await executionEngine.notifyForkchoiceUpdate(bytesToData(payload.blockHash), genesisBlockHash, genesisBlockHash);

    if (TX_SCENARIOS.includes("simple")) {
      const balance = await getBalance(ethRpcUrl, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      if (balance !== "0x9184e72a") throw new Error("Invalid Balance");
    }

    // Error cases
    // 1. unknown payload

    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_getPayload",
     * "params":["0x123"]
     * ,"id":67}' http://localhost:8545
     */

    // await executionEngine.getPayload(1234567);

    // 2. unknown header

    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_consensusValidated","params":[{
     * "blockHash":"0x0000000000000000000000000000000000000000000000000000000000000000",
     * "status":"VALID"
     * }],"id":67}' http://localhost:8545
     */
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

  it("Pre-merge, run for a few blocks", async function () {
    console.log("\n\nPre-merge, run for a few blocks\n\n");
    const {elClient, tearDownCallBack} = await runEL(
      {...elSetupConfig, mode: ELStartMode.PreMerge},
      {...elRunOptions, ttd: BigInt(terminalTotalDifficultyPreMerge)},
      controller.signal
    );
    afterEachCallbacks.push(() => tearDownCallBack());

    await runNodeWithEL.bind(this)({
      elClient,
      bellatrixEpoch: 1,
      testName: "pre-merge",
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
      logFile: `${logFilesDir}/merge-interop-${testName}.log`,
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
        eth1: {enabled: true, providerUrls: [engineRpcUrl], jwtSecretHex},
        executionEngine: {urls: [engineRpcUrl], jwtSecretHex},
        chain: {suggestedFeeRecipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
      },
      validatorCount: validatorClientCount * validatorsPerClient,
      logger: loggerNodeA,
      genesisTime,
      eth1BlockHash: fromHexString(genesisBlockHash),
    });

    afterEachCallbacks.push(async function () {
      await bn.close();
      await sleep(1000);
    });

    const stopInfoTracker = simTestInfoTracker(bn, loggerNodeA);
    const valProposerConfig = {
      proposerConfig: {
        "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c": {
          graffiti: "graffiti",
          strictFeeRecipientCheck: true,
          feeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          builder: {
            enabled: false,
            gasLimit: 30000000,
          },
        },
        "0xa4855c83d868f772a579133d9f23818008417b743e8447e235d8eb78b1d8f8a9f63f98c551beb7de254400f89592314d": {
          feeRecipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          builder: {
            enabled: true,
            gasLimit: 35000000,
          },
        },
      },
      defaultConfig: {
        graffiti: "default graffiti",
        strictFeeRecipientCheck: true,
        feeRecipient: "0xcccccccccccccccccccccccccccccccccccccccc",
        builder: {
          enabled: false,
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
      // Play TX_SCENARIOS
      bn.chain.emitter.on(ChainEvent.clockSlot, async (slot) => {
        if (slot < 2) return;
        switch (slot) {
          // If bellatrixEpoch > 0, this is the case of pre-merge transaction confirmation on EL pow
          case 2:
            if (TX_SCENARIOS.includes("simple")) {
              const balance = await getBalance(ethRpcUrl, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
              if (balance !== "0x9184e72a") reject("Invalid Balance");
            }
            break;

          // By this slot, ttd should be reached and merge complete
          case Number(ttd) + 3: {
            const headState = bn.chain.getHeadState();
            if (!(isExecutionStateType(headState) && isMergeTransitionComplete(headState))) {
              reject("Merge not completed");
            }

            // Send another tx post-merge, total amount in destination account should be double after this is included in chain
            if (TX_SCENARIOS.includes("simple")) {
              await sendTransaction(ethRpcUrl, {
                from: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
                to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                gas: "0x76c0",
                gasPrice: "0x9184e72a000",
                value: "0x9184e72a",
              });
            }
            break;
          }

          default:
        }
      });

      bn.chain.emitter.on(ChainEvent.finalized, (checkpoint) => {
        // Resolve only if the finalized checkpoint includes execution payload
        const finalizedBlock = bn.chain.forkChoice.getBlock(checkpoint.root);
        if (finalizedBlock?.executionPayloadBlockHash !== null) {
          console.log(`\nGot event ${event}, stopping validators and nodes\n`);
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
    const executionHeadBlockNumber = await rpc.getBlockNumber();
    const executionHeadBlock = await rpc.getBlockByNumber(executionHeadBlockNumber);
    if (!executionHeadBlock) throw Error("Execution has not head block");
    if (consensusHead.executionPayloadBlockHash !== executionHeadBlock.hash) {
      throw Error(
        "Consensus head not equal to execution head: " +
          JSON.stringify({
            executionHeadBlockNumber,
            executionHeadBlockHash: executionHeadBlock.hash,
            consensusHeadExecutionPayloadBlockHash: consensusHead.executionPayloadBlockHash,
            consensusHeadSlot: consensusHead.slot,
          })
      );
    }

    if (TX_SCENARIOS.includes("simple")) {
      const balance = await getBalance(ethRpcUrl, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      // 0x12309ce54 = 2 * 0x9184e72a
      if (balance !== "0x12309ce54") throw Error("Invalid Balance");
    }

    // wait for 1 slot to print current epoch stats
    await sleep(1 * bn.config.SECONDS_PER_SLOT * 1000);
    stopInfoTracker();
    console.log("\n\nDone\n\n");
  }
});
