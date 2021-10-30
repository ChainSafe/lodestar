import fs from "fs";
import path from "path";
import net from "net";
import {spawn} from "child_process";
import {Context} from "mocha";
import {AbortController, AbortSignal} from "@chainsafe/abort-controller";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {LogLevel, sleep, TimestampFormatCode} from "@chainsafe/lodestar-utils";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {Epoch} from "@chainsafe/lodestar-types";
import {dataToBytes, quantityToNum} from "../../src/eth1/provider/utils";
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

// NOTE: Must specify GETH_BINARY_PATH ENV
// Example:
// ```
// $ GETH_BINARY_PATH=/home/lion/Code/eth2.0/merge-interop/go-ethereum/build/bin/geth ../../node_modules/.bin/mocha test/sim/merge.test.ts
// ```

/* eslint-disable no-console, @typescript-eslint/naming-convention, quotes */

// MERGE_EPOCH will happen at 2 sec * 8 slots = 16 sec
// 10 ttd / 2 difficulty per block = 5 blocks * 5 sec = 25 sec
const terminalTotalDifficultyPreMerge = 20;

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

  /**
   * Start Geth process, accumulate stdout stderr and kill the process on afterEach() hook
   */
  function startGethProcess(args: string[]): void {
    if (!process.env.GETH_BINARY_PATH) {
      throw Error("GETH_BINARY_PATH ENV must be provided");
    }

    const gethProc = spawn(process.env.GETH_BINARY_PATH, args);

    gethProc.stdout.on("data", (chunk) => {
      const str = Buffer.from(chunk).toString("utf8");
      process.stdout.write(`GETH ${gethProc.pid}: ${str}`); // str already contains a new line. console.log adds a new line
    });
    gethProc.stderr.on("data", (chunk) => {
      const str = Buffer.from(chunk).toString("utf8");
      process.stderr.write(`GETH ${gethProc.pid}: ${str}`); // str already contains a new line. console.log adds a new line
    });

    gethProc.on("exit", (code) => {
      console.log("Geth exited", {code});
    });

    afterEachCallbacks.push(async function () {
      if (gethProc.killed) {
        throw Error("Geth is killed before end of test");
      }

      console.log("Killing Geth process", gethProc.pid);
      await shell(`kill ${gethProc.pid}`);

      // Wait for the P2P to be offline
      await waitForGethOffline();
      console.log("Geth successfully killed!");
    });
  }

  // Ref: https://notes.ethereum.org/@9AeMAlpyQYaAAyuj47BzRw/rkwW3ceVY
  // Build geth from source at branch https://github.com/ethereum/go-ethereum/pull/23607
  // $ ./go-ethereum/build/bin/geth --catalyst --datadir "~/ethereum/taunus" init genesis.json
  // $ ./build/bin/geth --catalyst --http --ws -http.api "engine" --datadir "~/ethereum/taunus" console
  async function runGethPostMerge(): Promise<{genesisBlockHash: string}> {
    if (!process.env.GETH_BINARY_PATH) {
      throw Error("GETH_BINARY_PATH ENV must be provided");
    }

    await shell(`rm -rf ${dataPath}`);
    fs.mkdirSync(dataPath, {recursive: true});

    const genesisPath = path.join(dataPath, "genesis.json");
    fs.writeFileSync(genesisPath, JSON.stringify(genesisGethPostMerge, null, 2));

    // Use as check to ensure geth is available and built correctly.
    // Note: Use double quotes on paths to let bash expand the ~ character
    await shell(`${process.env.GETH_BINARY_PATH} --catalyst --datadir "${dataPath}" init "${genesisPath}"`);

    startGethProcess(["--catalyst", "--http", "--ws", "-http.api", "engine,net,eth", "--datadir", dataPath]);

    // Wait for Geth to be online
    const controller = new AbortController();
    afterEachCallbacks.push(() => controller?.abort());
    await waitForGethOnline(jsonRpcUrl, controller.signal);

    // Fetch genesis block hash
    const genesisBlockHash = await getGenesisBlockHash(jsonRpcUrl, controller.signal);
    return {genesisBlockHash};
  }

  // Ref: https://notes.ethereum.org/_UH57VUPRrC-re3ubtmo2w
  // Build geth from source at branch https://github.com/ethereum/go-ethereum/pull/23607
  async function runGethPreMerge(): Promise<{genesisBlockHash: string}> {
    const privKey = "45a915e4d060149eb4365960e6a7a45f334393093061116b197e3240065ff2d8";
    const pubKey = "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b";
    const password = "12345678";

    if (!process.env.GETH_BINARY_PATH) {
      throw Error("GETH_BINARY_PATH ENV must be provided");
    }

    await shell(`rm -rf ${dataPath}`);
    fs.mkdirSync(dataPath, {recursive: true});

    const genesisPath = path.join(dataPath, "genesis.json");
    const skPath = path.join(dataPath, "sk.json");
    const passwordPath = path.join(dataPath, "password.txt");
    fs.writeFileSync(genesisPath, JSON.stringify(genesisGethPreMerge, null, 2));
    fs.writeFileSync(skPath, privKey);
    fs.writeFileSync(passwordPath, password);

    // Use as check to ensure geth is available and built correctly.
    // Note: Use double quotes on paths to let bash expand the ~ character
    //  ./build/bin/geth --catalyst --datadir "~/ethereum/taunus" init genesis.json
    console.log("Initilizing Geth");
    await shell(`${process.env.GETH_BINARY_PATH} --catalyst --datadir "${dataPath}" init "${genesisPath}"`);

    // Import the signing key (press enter twice for empty password):
    //  ./build/bin/geth --catalyst --datadir "~/ethereum/taunus" account import sk.json
    console.log("Importing account to Geth");
    await shell(
      `${process.env.GETH_BINARY_PATH} --catalyst --datadir "${dataPath}" account import "${skPath}" --password ${passwordPath}`
    );

    startGethProcess([
      "--catalyst",
      "--http",
      "--ws",
      "-http.api",
      "engine,net,eth,miner",
      "--datadir",
      dataPath,
      "--allow-insecure-unlock",
      "--unlock",
      pubKey,
      "--password",
      passwordPath,
      "--nodiscover",
      // Automatically start mining
      "--mine",
    ]);

    // Wait for Geth to be online
    const controller = new AbortController();
    afterEachCallbacks.push(() => controller?.abort());
    await waitForGethOnline(jsonRpcUrl, controller.signal);

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
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_preparePayload","params":[{
     * "parentHash":gensisBlockHash,
     * "timestamp":"0x5",
     * "random":"0x0000000000000000000000000000000000000000000000000000000000000000",
     * "feeRecipient":"0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b"
     * }],"id":67}' http://localhost:8545
     *
     * {"jsonrpc":"2.0","id":67,"result":{"payloadId":"0x0"}}
     */

    const preparePayloadParams = {
      // Note: this is created with a pre-defined genesis.json
      parentHash: genesisBlockHash,
      timestamp: "0x5",
      random: "0x0000000000000000000000000000000000000000000000000000000000000000",
      feeRecipient: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
    };

    const payloadId = await executionEngine.preparePayload(
      dataToBytes(preparePayloadParams.parentHash),
      quantityToNum(preparePayloadParams.timestamp),
      dataToBytes(preparePayloadParams.random),
      dataToBytes(preparePayloadParams.feeRecipient)
    );

    // 2. Get the payload

    const payload = await executionEngine.getPayload(payloadId);

    // 3. Execute the payload

    const payloadResult = await executionEngine.executePayload(payload);
    if (!payloadResult) {
      throw Error("getPayload returned payload that executePayload deems invalid");
    }

    // 4. Update the fork choice

    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_forkchoiceUpdated","params":[{
     * "headBlockHash":"0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
     * "finalizedBlockHash":"0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174"
     * }],"id":67}' http://localhost:8545
     */

    await executionEngine.notifyForkchoiceUpdate(toHexString(payload.blockHash), toHexString(payload.blockHash));

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

  it("Pre-merge, run for a few blocks", async function () {
    console.log("\n\nPre-merge, run for a few blocks\n\n");
    const {genesisBlockHash} = await runGethPreMerge();
    await runNodeWithGeth.bind(this)({
      genesisBlockHash,
      mergeEpoch: 1,
      ttd: BigInt(terminalTotalDifficultyPreMerge),
      testName: "pre-merge",
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

/**
 * From https://notes.ethereum.org/@9AeMAlpyQYaAAyuj47BzRw/rkwW3ceVY
 *
 * NOTE: Edited gasLimit to match 30_000_000 value is subsequent block generation
 */
const genesisGethPostMerge = {
  config: {
    chainId: 1,
    homesteadBlock: 0,
    daoForkBlock: 0,
    daoForkSupport: true,
    eip150Block: 0,
    eip155Block: 0,
    eip158Block: 0,
    byzantiumBlock: 0,
    constantinopleBlock: 0,
    petersburgBlock: 0,
    istanbulBlock: 0,
    muirGlacierBlock: 0,
    berlinBlock: 0,
    londonBlock: 0,
    clique: {
      period: 5,
      epoch: 30000,
    },
    terminalTotalDifficulty: 0,
  },
  nonce: "0x42",
  timestamp: "0x0",
  extraData:
    "0x0000000000000000000000000000000000000000000000000000000000000000a94f5374fce5edbc8e2a8697c15331677e6ebf0b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  gasLimit: "0x1c9c380",
  difficulty: "0x400000000",
  mixHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  coinbase: "0x0000000000000000000000000000000000000000",
  alloc: {
    "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b": {balance: "0x6d6172697573766477000000"},
  },
  number: "0x0",
  gasUsed: "0x0",
  parentHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  baseFeePerGas: "0x7",
};

/**
 * From https://notes.ethereum.org/_UH57VUPRrC-re3ubtmo2w
 */
const genesisGethPreMerge = {
  config: {
    chainId: 1,
    homesteadBlock: 0,
    eip150Block: 0,
    eip150Hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    eip155Block: 0,
    eip158Block: 0,
    byzantiumBlock: 0,
    constantinopleBlock: 0,
    petersburgBlock: 0,
    istanbulBlock: 0,
    muirGlacierBlock: 0,
    berlinBlock: 0,
    londonBlock: 0,
    clique: {
      period: 5,
      epoch: 30000,
    },
    terminalTotalDifficulty: terminalTotalDifficultyPreMerge,
  },
  nonce: "0x42",
  timestamp: "0x0",
  extraData:
    "0x0000000000000000000000000000000000000000000000000000000000000000a94f5374fce5edbc8e2a8697c15331677e6ebf0b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  gasLimit: "0x1c9c380",
  difficulty: "0x0",
  mixHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  coinbase: "0x0000000000000000000000000000000000000000",
  alloc: {
    "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b": {balance: "0x6d6172697573766477000000"},
  },
  number: "0x0",
  gasUsed: "0x0",
  parentHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  baseFeePerGas: "0x7",
};

async function waitForGethOnline(url: string, signal: AbortSignal): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      console.log("Waiting for geth online...");
      await shell(
        `curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"net_version","params":[],"id":67}' ${url}`
      );
      return; // Done
    } catch (e) {
      await sleep(1000, signal);
    }
  }
  throw Error("Geth not online in 60 seconds");
}

async function waitForGethOffline(): Promise<void> {
  const port = 30303;

  for (let i = 0; i < 60; i++) {
    console.log("Waiting for geth offline...");
    const isInUse = await isPortInUse(port);
    if (!isInUse) {
      return;
    }
    await sleep(1000);
  }
  throw Error("Geth not offline in 60 seconds");
}

async function isPortInUse(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", function (err) {
      if (((err as unknown) as {code: string}).code === "EADDRINUSE") {
        resolve(true);
      } else {
        reject(err);
      }
    });

    server.once("listening", function () {
      // close the server if listening doesn't fail
      server.close(() => {
        resolve(false);
      });
    });

    server.listen(port);
  });
}

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
