import fs from "fs";
import path from "path";
import {AbortController, AbortSignal} from "@chainsafe/abort-controller";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {LogLevel, sleep, TimestampFormatCode} from "@chainsafe/lodestar-utils";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {hexToNumber} from "../../src/eth1/provider/utils";
import {ExecutionEngineHttp, parseExecutionPayload} from "../../src/executionEngine/http";
import {shell} from "./shell";
import {ChainEvent} from "../../src/chain";
import {testLogger, TestLoggerOpts} from "../utils/logger";
import {logFilesDir} from "./params";
import {getDevBeaconNode} from "../utils/node/beacon";
import {RestApiOptions} from "../../src/api";
import {simTestInfoTracker} from "../utils/node/simTest";
import {waitForEvent} from "../utils/events/resolver";
import {getAndInitDevValidators} from "../utils/node/validator";
import {Eth1Provider} from "../../src";
import {ZERO_HASH} from "../../src/constants";

// NOTE: Must specify GETH_BINARY_PATH ENV
// Example:
// ```
// $ GETH_BINARY_PATH=/home/lion/Code/eth2.0/merge-interop/go-ethereum/build/bin/geth ../../node_modules/.bin/mocha test/sim/merge.test.ts
// ```

describe("executionEngine / ExecutionEngineHttp", function () {
  this.timeout("10min");

  const dataPath = "~/ethereum/taunus";
  const genesisPath = path.join(dataPath, "genesis.json");
  const jsonRpcPort = 8545;
  const enginePort = 8545;
  const jsonRpcUrl = `http://localhost:${jsonRpcPort}`;
  const engineApiUrl = `http://localhost:${enginePort}`;

  let gensisBlockHash: string;
  let gethProcError: Error | null = null;
  let controller: AbortController;

  // Ref: https://notes.ethereum.org/@9AeMAlpyQYaAAyuj47BzRw/rkwW3ceVY
  // Build geth from source at branch https://github.com/ethereum/go-ethereum/pull/23607
  // $ ./go-ethereum/build/bin/geth --catalyst --datadir "~/ethereum/taunus" init genesis.json
  // $ ./build/bin/geth --catalyst --http --ws -http.api "engine" --datadir "~/ethereum/taunus" console

  before("Run Geth", async () => {
    if (!process.env.GETH_BINARY_PATH) {
      throw Error("GETH_BINARY_PATH ENV must be provided");
    }

    await shell(`rm -rf ${dataPath}`);
    fs.mkdirSync(dataPath, {recursive: true});
    writeGenesisJson(genesisPath);

    // Use as check to ensure geth is available and built correctly.
    // Note: Use double quotes on paths to let bash expand the ~ character
    await shell(`${process.env.GETH_BINARY_PATH} --catalyst --datadir "${dataPath}" init "${genesisPath}"`);

    controller = new AbortController();
    shell(`${process.env.GETH_BINARY_PATH} --catalyst --http --ws -http.api "engine,net,eth" --datadir "${dataPath}"`, {
      timeout: 10 * 60 * 1000,
      signal: controller.signal,
    }).catch((e) => {
      gethProcError = e as Error;
    });

    // Wait for Geth to be online
    await waitForGethOnline(jsonRpcUrl, controller.signal);

    // Fetch genesis block hash
    gensisBlockHash = await getGenesisBlockHash(jsonRpcUrl, controller.signal);
  });

  after("Stop geth", () => {
    if (gethProcError !== null) {
      gethProcError.message = `Geth process stopped before end of test: ${gethProcError.message}`;
      throw gethProcError;
    }

    // Kills geth process
    if (controller) controller.abort();
  });

  /* eslint-disable no-console, @typescript-eslint/naming-convention */

  it("Run for a few blocks", async () => {
    const validatorClientCount = 1;
    const validatorsPerClient = 32;
    const event = ChainEvent.finalized;
    const altairForkEpoch = 0;
    const mergeForkEpoch = 0;

    const testParams: Pick<IChainConfig, "SECONDS_PER_SLOT"> = {
      SECONDS_PER_SLOT: 2,
    };

    // Should reach justification in 3 epochs max, and finalization in 4 epochs max
    const expectedEpochsToFinish = 4;
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
      logFile: `${logFilesDir}/singlethread_singlenode_altair-${altairForkEpoch}_merge-${mergeForkEpoch}_vc-${validatorClientCount}_vs-${validatorsPerClient}_event-${event}.log`,
      timestampFormat: {
        format: TimestampFormatCode.EpochSlot,
        genesisTime,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        secondsPerSlot: testParams.SECONDS_PER_SLOT,
      },
    };
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);

    const bn = await getDevBeaconNode({
      params: {...testParams, ALTAIR_FORK_EPOCH: 0, MERGE_FORK_EPOCH: 0, TERMINAL_TOTAL_DIFFICULTY: BigInt(0)},
      options: {
        api: {rest: {enabled: true} as RestApiOptions},
        sync: {isSingleNode: true},
        network: {disablePeerDiscovery: true},
        executionEngine: {urls: [engineApiUrl]},
      },
      validatorCount: validatorClientCount * validatorsPerClient,
      logger: loggerNodeA,
      genesisTime,
      eth1BlockHash: fromHexString(gensisBlockHash),
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

  it("Test against real geth", async () => {
    // Assume geth is already running

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
      parentHash: gensisBlockHash,
      timestamp: "0x5",
      random: "0x0000000000000000000000000000000000000000000000000000000000000000",
      feeRecipient: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
    };

    const payloadId = await executionEngine.preparePayload(
      fromHexString(preparePayloadParams.parentHash),
      hexToNumber(preparePayloadParams.timestamp),
      fromHexString(preparePayloadParams.random),
      fromHexString(preparePayloadParams.feeRecipient)
    );

    // 2. Get the payload

    const payload = await executionEngine.getPayload(payloadId);
    const payloadResult = await executionEngine.executePayload(payload);
    if (!payloadResult) {
      throw Error("getPayload returned payload that executePayload deems invalid");
    }

    // 3. Execute the payload

    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_executePayload","params":[{
     * "blockHash":"0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
     * "parentHash":gensisBlockHash,
     * "coinbase":"0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
     * "stateRoot":"0xca3149fa9e37db08d1cd49c9061db1002ef1cd58db2210f2115c8c989b2bdf45",
     * "receiptRoot":"0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
     * "logsBloom":"0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
     * "random":"0x0000000000000000000000000000000000000000000000000000000000000000",
     * "blockNumber":"0x1",
     * "gasLimit":"0x1c9c380",
     * "gasUsed":"0x0",
     * "timestamp":"0x5",
     * "extraData":"0x",
     * "baseFeePerGas":"0x7",
     * "transactions":[]
     * }],"id":67}' http://localhost:8545
     */

    const payloadToTest = parseExecutionPayload({
      blockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
      parentHash: gensisBlockHash,
      coinbase: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
      stateRoot: "0xca3149fa9e37db08d1cd49c9061db1002ef1cd58db2210f2115c8c989b2bdf45",
      receiptRoot: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
      logsBloom:
        "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      random: "0x0000000000000000000000000000000000000000000000000000000000000000",
      blockNumber: "0x1",
      gasLimit: "0x1c9c380",
      gasUsed: "0x0",
      timestamp: "0x5",
      extraData: "0x",
      baseFeePerGas: "0x7",
      transactions: [],
    });

    const payloadToTestResult = await executionEngine.executePayload(payloadToTest);
    if (!payloadToTestResult) {
      throw Error("Test payload is invalid");
    }

    // 4. Mark the payload as valid

    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_consensusValidated","params":[{
     * "blockHash":"0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
     * "status":"VALID"
     * }],"id":67}' http://localhost:8545
     */

    await executionEngine.notifyConsensusValidated(payloadToTest.blockHash, true);

    // 5. Update the fork choice

    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_forkchoiceUpdated","params":[{
     * "headBlockHash":"0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
     * "finalizedBlockHash":"0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174"
     * }],"id":67}' http://localhost:8545
     */

    await executionEngine.notifyForkchoiceUpdate(
      toHexString(payloadToTest.blockHash),
      toHexString(payloadToTest.blockHash)
    );

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
});

/**
 * From https://notes.ethereum.org/@9AeMAlpyQYaAAyuj47BzRw/rkwW3ceVY
 *
 * NOTE: Edited gasLimit to match 30_000_000 value is subsequent block generation
 */
function writeGenesisJson(filepath: string): void {
  const data = `{
  "config": {
    "chainId": 1,
    "homesteadBlock": 0,
    "daoForkBlock": 0,
    "daoForkSupport": true,
    "eip150Block": 0,
    "eip155Block": 0,
    "eip158Block": 0,
    "byzantiumBlock": 0,
    "constantinopleBlock": 0,
    "petersburgBlock": 0,
    "istanbulBlock": 0,
    "muirGlacierBlock": 0,
    "berlinBlock": 0,
    "londonBlock": 0,
    "clique": {
      "period": 5,
      "epoch": 30000
    },
    "terminalTotalDifficulty": 0
  },
  "nonce": "0x42",
  "timestamp": "0x0",
  "extraData": "0x0000000000000000000000000000000000000000000000000000000000000000a94f5374fce5edbc8e2a8697c15331677e6ebf0b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "gasLimit": "0x1c9c380",
  "difficulty": "0x400000000",
  "mixHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "coinbase": "0x0000000000000000000000000000000000000000",
  "alloc": {
    "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b": {"balance": "0x6d6172697573766477000000"}
  },
  "number": "0x0",
  "gasUsed": "0x0",
  "parentHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "baseFeePerGas": "0x7"
}`;
  fs.writeFileSync(filepath, data);
}

async function waitForGethOnline(url: string, signal: AbortSignal): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
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

async function getGenesisBlockHash(url: string, signal: AbortSignal): Promise<string> {
  const eth1Provider = new Eth1Provider(
    ({DEPOSIT_CONTRACT_ADDRESS: ZERO_HASH} as Partial<IChainConfig>) as IChainConfig,
    {providerUrls: [url], enabled: true, depositContractDeployBlock: 0},
    signal
  );

  const genesisBlock = await eth1Provider.getBlockByNumber(0);
  if (!genesisBlock) {
    throw Error("No genesis block available");
  }

  return genesisBlock.hash;
}
