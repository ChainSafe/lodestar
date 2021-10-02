import fs from "fs";
import path from "path";
import {AbortController} from "@chainsafe/abort-controller";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {hexToNumber} from "../../src/eth1/provider/utils";
import {ExecutionEngineHttp, parseExecutionPayload} from "../../src/executionEngine/http";
import {shell} from "./shell";
import {sleep} from "@chainsafe/lodestar-utils";

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

    fs.mkdirSync(dataPath, {recursive: true});
    writeGenesisJson(genesisPath);

    // Use as check to ensure geth is available and built correctly.
    // Note: Use double quotes on paths to let bash expand the ~ character
    await shell(`${process.env.GETH_BINARY_PATH} --catalyst --datadir "${dataPath}" init "${genesisPath}"`);

    controller = new AbortController();
    shell(`${process.env.GETH_BINARY_PATH} --catalyst --http --ws -http.api "engine,net" --datadir "${dataPath}"`, {
      timeout: 10 * 60 * 1000,
      signal: controller.signal,
    }).catch((e) => {
      gethProcError = e as Error;
    });

    // Wait for Geth to be online
    for (let i = 0; i < 60; i++) {
      try {
        await shell(
          `curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"net_version","params":[],"id":67}' http://localhost:${jsonRpcPort}`
        );
        return; // Done
      } catch (e) {
        await sleep(1000, controller.signal);
      }
    }
    throw Error("Geth not online in 60 seconds");
  });

  after("Stop geth", () => {
    if (gethProcError !== null) {
      gethProcError.message = `Geth process stopped before end of test: ${gethProcError.message}`;
      throw gethProcError;
    }

    // Kills geth process
    if (controller) controller.abort();
  });

  it("Test against real geth", async () => {
    // Assume geth is already running

    const gethUrl = `http://localhost:${enginePort}`;
    const controller = new AbortController();
    const executionEngine = new ExecutionEngineHttp({urls: [gethUrl]}, controller.signal);

    // 1. Prepare a payload

    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_preparePayload","params":[{
     * "parentHash":"0xa0513a503d5bd6e89a144c3268e5b7e9da9dbf63df125a360e3950a7d0d67131",
     * "timestamp":"0x5",
     * "random":"0x0000000000000000000000000000000000000000000000000000000000000000",
     * "feeRecipient":"0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b"
     * }],"id":67}' http://localhost:8545
     *
     * {"jsonrpc":"2.0","id":67,"result":{"payloadId":"0x0"}}
     */

    const preparePayloadParams = {
      // Note: this is created with a pre-defined genesis.json
      parentHash: "0xa0513a503d5bd6e89a144c3268e5b7e9da9dbf63df125a360e3950a7d0d67131",
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
     * "parentHash":"0xa0513a503d5bd6e89a144c3268e5b7e9da9dbf63df125a360e3950a7d0d67131",
     * "coinbase":"0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
     * "stateRoot":"0xca3149fa9e37db08d1cd49c9061db1002ef1cd58db2210f2115c8c989b2bdf45",
     * "receiptRoot":"0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
     * "logsBloom":"0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
     * "random":"0x0000000000000000000000000000000000000000000000000000000000000000",
     * "blockNumber":"0x1",
     * "gasLimit":"0x989680",
     * "gasUsed":"0x0",
     * "timestamp":"0x5",
     * "extraData":"0x",
     * "baseFeePerGas":"0x7",
     * "transactions":[]
     * }],"id":67}' http://localhost:8545
     */

    const payloadToTest = parseExecutionPayload({
      blockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
      parentHash: "0xa0513a503d5bd6e89a144c3268e5b7e9da9dbf63df125a360e3950a7d0d67131",
      coinbase: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
      stateRoot: "0xca3149fa9e37db08d1cd49c9061db1002ef1cd58db2210f2115c8c989b2bdf45",
      receiptRoot: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
      logsBloom:
        "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      random: "0x0000000000000000000000000000000000000000000000000000000000000000",
      blockNumber: "0x1",
      gasLimit: "0x989680",
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
  "gasLimit": "0x989680",
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
