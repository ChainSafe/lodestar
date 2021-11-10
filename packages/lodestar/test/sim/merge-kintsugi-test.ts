import fs from "fs";
import {Context} from "mocha";
import {AbortController, AbortSignal} from "@chainsafe/abort-controller";
import {fromHexString} from "@chainsafe/ssz";
import {LogLevel, sleep, TimestampFormatCode} from "@chainsafe/lodestar-utils";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {Epoch} from "@chainsafe/lodestar-types";
import {ExecutionEngineHttp} from "../../src/executionEngine/http";
import {shell} from "./shell";
import {ChainEvent} from "../../src/chain";
import {testLogger, TestLoggerOpts} from "../utils/logger";
import {logFilesDir} from "./params";
import {getDevBeaconNode} from "../utils/node/beacon";
import {RestApiOptions} from "../../src/api";
import {simTestInfoTracker} from "../utils/node/simTest";
import {getAndInitDevValidators} from "../utils/node/validator";
import {Eth1Provider} from "../../src";
import {ZERO_HASH} from "../../src/constants";
import {bytesToData, dataToBytes, quantityToNum} from "../../src/eth1/provider/utils";

// NOTE: This file has been tested on a running geth outside CI, might be reworked or scrapped once CI interop test file: merge-interop.test.ts works just fine.

/* eslint-disable no-console, @typescript-eslint/naming-convention, quotes */

describe("executionEngine / ExecutionEngineHttp", function () {
  this.timeout("10min");

  const dataPath = fs.mkdtempSync("lodestar-test-merge-interop");
  const jsonRpcPort = 8545;
  const enginePort = 8545;
  const jsonRpcUrl = `http://localhost:${jsonRpcPort}`;
  const engineApiUrl = `http://localhost:${enginePort}`;

  after(async () => {
    await shell(`rm -rf ${dataPath}`);
  });

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  // Ref: https://notes.ethereum.org/@9AeMAlpyQYaAAyuj47BzRw/rkwW3ceVY
  // Build geth from source at branch https://github.com/ethereum/go-ethereum/pull/23607
  // $ ./go-ethereum/build/bin/geth --catalyst --datadir "~/ethereum/taunus" init genesis.json
  // $ ./build/bin/geth --catalyst --http --ws -http.api "engine" --datadir "~/ethereum/taunus" console
  async function runGethPostMerge(): Promise<{genesisBlockHash: string}> {
    await shell(`rm -rf ${dataPath}`);
    fs.mkdirSync(dataPath, {recursive: true});

    const controller = new AbortController();

    // Fetch genesis block hash
    const genesisBlockHash = await getGenesisBlockHash(jsonRpcUrl, controller.signal);
    return {genesisBlockHash};
  }

  it("Send stub payloads to Geth", async () => {
    const {genesisBlockHash} = await runGethPostMerge();

    const controller = new AbortController();
    const executionEngine = new ExecutionEngineHttp({urls: [engineApiUrl]}, controller.signal);

    // 1. Prepare a payload

    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_forkchoiceUpdatedV1","params":[{"headBlockHash":"0x3b8fb240d288781d4aac94d3fd16809ee413bc99294a085798a589dae51ddd4a", "safeBlockHash":"0x3b8fb240d288781d4aac94d3fd16809ee413bc99294a085798a589dae51ddd4a", "finalizedBlockHash":"0x0000000000000000000000000000000000000000000000000000000000000000"}, {"timestamp":"0x5", "random":"0x0000000000000000000000000000000000000000000000000000000000000000", "feeRecipient":"0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b"}],"id":67}' http://localhost:8550
     **/

    const preparePayloadParams = {
      // Note: this is created with a pre-defined genesis.json
      timestamp: quantityToNum("0x5"),
      random: dataToBytes("0x0000000000000000000000000000000000000000000000000000000000000000"),
      feeRecipient: dataToBytes("0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b"),
    };

    const finalizedBlockHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

    const payloadId = await executionEngine.notifyForkchoiceUpdate(
      genesisBlockHash,
      finalizedBlockHash,
      preparePayloadParams
    );

    if (!payloadId) throw Error("InvalidPayloadId");

    // 2. Get the payload
    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_getPayloadV1","params":["0xa247243752eb10b4"],"id":67}' http://localhost:8550
     **/

    const payload = await executionEngine.getPayload(payloadId);

    // 3. Execute the payload
    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_executePayloadV1","params":[{"parentHash":"0x3b8fb240d288781d4aac94d3fd16809ee413bc99294a085798a589dae51ddd4a","coinbase":"0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b","stateRoot":"0xca3149fa9e37db08d1cd49c9061db1002ef1cd58db2210f2115c8c989b2bdf45","receiptRoot":"0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421","logsBloom":"0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000","random":"0x0000000000000000000000000000000000000000000000000000000000000000","blockNumber":"0x1","gasLimit":"0x1c9c380","gasUsed":"0x0","timestamp":"0x5","extraData":"0x","baseFeePerGas":"0x7","blockHash":"0x3559e851470f6e7bbed1db474980683e8c315bfce99b2a6ef47c057c04de7858","transactions":[]}],"id":67}' http://localhost:8550
     * **/

    const payloadResult = await executionEngine.executePayload(payload);
    if (!payloadResult) {
      throw Error("getPayload returned payload that executePayload deems invalid");
    }

    // 4. Update the fork choice

    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_forkchoiceUpdatedV1","params":[{"headBlockHash":"0x3559e851470f6e7bbed1db474980683e8c315bfce99b2a6ef47c057c04de7858", "safeBlockHash":"0x3559e851470f6e7bbed1db474980683e8c315bfce99b2a6ef47c057c04de7858", "finalizedBlockHash":"0x3b8fb240d288781d4aac94d3fd16809ee413bc99294a085798a589dae51ddd4a"}, null],"id":67}' http://localhost:8550
     **/

    await executionEngine.notifyForkchoiceUpdate(bytesToData(payload.blockHash), genesisBlockHash);

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
    const {genesisBlockHash} = await runGethPostMerge();
    await runNodeWithGeth.bind(this)({
      genesisBlockHash,
      mergeEpoch: 0,
      ttd: BigInt(0),
      testName: "post-merge",
    });
  });

  async function runNodeWithGeth(
    this: Context,
    {
      genesisBlockHash,
      mergeEpoch,
      ttd,
      testName,
    }: {genesisBlockHash: string; mergeEpoch: Epoch; ttd: bigint; testName: string}
  ): Promise<void> {
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
      params: {...testParams, ALTAIR_FORK_EPOCH: 0, MERGE_FORK_EPOCH: mergeEpoch, TERMINAL_TOTAL_DIFFICULTY: ttd},
      options: {
        api: {rest: {enabled: true} as RestApiOptions},
        sync: {isSingleNode: true},
        network: {discv5: null},
        eth1: {enabled: true, providerUrls: [jsonRpcUrl]},
        executionEngine: {urls: [engineApiUrl]},
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

    const validators = await getAndInitDevValidators({
      node: bn,
      validatorsPerClient,
      validatorClientCount,
      startIndex: 0,
      // At least one sim test must use the REST API for beacon <-> validator comms
      useRestApi: true,
      testLoggerOpts,
    });

    afterEachCallbacks.push(async function () {
      await Promise.all(validators.map((v) => v.stop()));
    });

    await Promise.all(validators.map((v) => v.start()));

    await new Promise<void>((resolve) => {
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
    await Promise.all(validators.map((v) => v.stop()));
    await bn.close();
    await sleep(500);

    // Assertions to make sure the end state is good
    // 1. The proper head is set
    const rpc = new Eth1Provider({DEPOSIT_CONTRACT_ADDRESS: ZERO_HASH}, {providerUrls: [jsonRpcUrl]});
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

    // wait for 1 slot to print current epoch stats
    await sleep(1 * bn.config.SECONDS_PER_SLOT * 1000);
    stopInfoTracker();
    console.log("\n\nDone\n\n");
  }
});

async function getGenesisBlockHash(url: string, signal: AbortSignal): Promise<string> {
  const eth1Provider = new Eth1Provider(
    ({DEPOSIT_CONTRACT_ADDRESS: ZERO_HASH} as Partial<IChainConfig>) as IChainConfig,
    {providerUrls: [url]},
    signal
  );

  const genesisBlock = await eth1Provider.getBlockByNumber(0);
  if (!genesisBlock) {
    throw Error("No genesis block available");
  }

  return genesisBlock.hash;
}
