import {fastify} from "fastify";
import {describe, it, expect, beforeAll, afterAll} from "vitest";
import {ForkName} from "@lodestar/params";
import {Logger} from "@lodestar/logger";
import {defaultExecutionEngineHttpOpts} from "../../../src/execution/engine/http.js";
import {IExecutionEngine, initializeExecutionEngine} from "../../../src/execution/index.js";
import {
  parseExecutionPayload,
  serializeExecutionPayload,
  serializeExecutionPayloadBody,
} from "../../../src/execution/engine/types.js";
import {RpcPayload} from "../../../src/eth1/interface.js";
import {numToQuantity} from "../../../src/eth1/provider/utils.js";

describe("ExecutionEngine / http", () => {
  const afterCallbacks: (() => Promise<void> | void)[] = [];
  afterAll(async () => {
    while (afterCallbacks.length > 0) {
      const callback = afterCallbacks.pop();
      if (callback) await callback();
    }
  });

  let executionEngine: IExecutionEngine;
  let returnValue: unknown = {};
  let reqJsonRpcPayload: unknown = {};

  beforeAll(async () => {
    const controller = new AbortController();
    const server = fastify({logger: false});

    server.post("/", async (req) => {
      if ((req.body as RpcPayload).method === "engine_getClientVersionV1") {
        // Ignore client version requests
        return [];
      }
      reqJsonRpcPayload = req.body;
      (reqJsonRpcPayload as {id?: number}).id = undefined;
      return returnValue;
    });

    afterCallbacks.push(async () => {
      controller.abort();
      await server.close();
    });

    const baseUrl = await server.listen({port: 0});

    executionEngine = initializeExecutionEngine(
      {
        mode: "http",
        urls: [baseUrl],
        retries: defaultExecutionEngineHttpOpts.retries,
        retryDelay: defaultExecutionEngineHttpOpts.retryDelay,
      },
      {signal: controller.signal, logger: console as unknown as Logger}
    );
  });

  it("getPayload", async () => {
    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_getPayload","params":["0x0"],"id":67}' http://localhost:8545
     */

    const request = {jsonrpc: "2.0", method: "engine_getPayloadV1", params: ["0x0"]};
    const response = {
      jsonrpc: "2.0",
      id: 67,
      result: {
        blockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
        parentHash: "0xa0513a503d5bd6e89a144c3268e5b7e9da9dbf63df125a360e3950a7d0d67131",
        feeRecipient: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
        stateRoot: "0xca3149fa9e37db08d1cd49c9061db1002ef1cd58db2210f2115c8c989b2bdf45",
        receiptsRoot: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
        logsBloom:
          "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        prevRandao: "0x0000000000000000000000000000000000000000000000000000000000000000",
        blockNumber: "0x1",
        gasLimit: "0x989680",
        gasUsed: "0x0",
        timestamp: "0x5",
        extraData: "0x",
        baseFeePerGas: "0x7",
        transactions: [],
      },
    };
    returnValue = response;

    const payloadWithValue = await executionEngine.getPayload(ForkName.bellatrix, "0x0");
    const payload = payloadWithValue.executionPayload;

    expect(serializeExecutionPayload(ForkName.bellatrix, payload)).toEqual(response.result);
    expect(reqJsonRpcPayload).toEqual(request);
  });

  it("notifyNewPayload", async () => {
    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_newPayloadV1","params":[{"blockHash":"0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174","parentHash":"0xa0513a503d5bd6e89a144c3268e5b7e9da9dbf63df125a360e3950a7d0d67131","coinbase":"0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b","stateRoot":"0xca3149fa9e37db08d1cd49c9061db1002ef1cd58db2210f2115c8c989b2bdf45","receiptRoot":"0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421","logsBloom":"0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000","prevRandao":"0x0000000000000000000000000000000000000000000000000000000000000000","blockNumber":"0x1","gasLimit":"0x989680","gasUsed":"0x0","timestamp":"0x5","extraData":"0x","baseFeePerGas":"0x7","transactions":[]}],"id":67}' http://localhost:8545
     */

    const request = {
      jsonrpc: "2.0",
      method: "engine_newPayloadV1",
      params: [
        {
          blockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
          parentHash: "0xa0513a503d5bd6e89a144c3268e5b7e9da9dbf63df125a360e3950a7d0d67131",
          feeRecipient: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
          stateRoot: "0xca3149fa9e37db08d1cd49c9061db1002ef1cd58db2210f2115c8c989b2bdf45",
          receiptsRoot: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
          logsBloom:
            "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
          prevRandao: "0x0000000000000000000000000000000000000000000000000000000000000000",
          blockNumber: "0x1",
          gasLimit: "0x989680",
          gasUsed: "0x0",
          timestamp: "0x5",
          extraData: "0x",
          baseFeePerGas: "0x7",
          transactions: [],
        },
      ],
    };
    returnValue = {
      jsonrpc: "2.0",
      id: 67,
      result: {status: "VALID", latestValidHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174"},
    };

    const {status} = await executionEngine.notifyNewPayload(
      ForkName.bellatrix,
      parseExecutionPayload(ForkName.bellatrix, request.params[0]).executionPayload
    );

    expect(status).toBe("VALID");
    expect(reqJsonRpcPayload).toEqual(request);
  });

  it("notifyForkchoiceUpdate", async () => {
    /**
     *  curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_forkchoiceUpdated","params":[{"headBlockHash":"0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174", "finalizedBlockHash":"0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174"}],"id":67}' http://localhost:8545
     */
    const forkChoiceHeadData = {
      headBlockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
      safeBlockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
      finalizedBlockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
    };

    const request = {
      jsonrpc: "2.0",
      method: "engine_forkchoiceUpdatedV1",
      params: [forkChoiceHeadData, null],
    };
    returnValue = {
      jsonrpc: "2.0",
      id: 67,
      result: {payloadStatus: {status: "VALID", latestValidHash: null, validationError: null}, payloadId: "0x"},
    };

    await executionEngine.notifyForkchoiceUpdate(
      ForkName.bellatrix,
      forkChoiceHeadData.headBlockHash,
      forkChoiceHeadData.safeBlockHash,
      forkChoiceHeadData.finalizedBlockHash
    );

    expect(reqJsonRpcPayload).toEqual(request);
  });

  it("getPayloadBodiesByHash", async () => {
    /**
     *  curl -X GET -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_getPayloadBodiesByHashV1","params":[
        [
          "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
          "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
        ]
      ],"id":67}' http://localhost:8545
     */
    const response = {
      jsonrpc: "2.0",
      id: 67,
      result: [
        {
          transactions: [
            "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
            "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
          ],
          withdrawals: [
            {
              index: "0x0",
              validatorIndex: "0xffff",
              address: "0x0200000000000000000000000000000000000000",
              amount: "0x7b",
            },
          ],
        },
        null, // null returned for missing blocks
        {
          transactions: [
            "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
            "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
          ],
          withdrawals: null, // withdrawals is null pre-capella
        },
      ],
    };

    const reqBlockHashes = [
      "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
      "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed111",
      "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed000",
    ];

    const request = {
      jsonrpc: "2.0",
      method: "engine_getPayloadBodiesByHashV1",
      params: [reqBlockHashes],
    };

    returnValue = response;

    const res = await executionEngine.getPayloadBodiesByHash(ForkName.bellatrix, reqBlockHashes);

    expect(reqJsonRpcPayload).toEqual(request);
    expect(res.map(serializeExecutionPayloadBody)).toEqual(response.result);
  });

  it("getPayloadBodiesByRange", async () => {
    /**
     *  curl -X GET -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_getPayloadBodiesByRangeV1","params":[ QUANTITY, QUANTITY],"id":67}' http://localhost:8545
     */
    const startBlockNumber = 2;
    const blockCount = 3;
    const response = {
      jsonrpc: "2.0",
      id: 67,
      result: [
        {
          transactions: [
            "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
            "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
          ],
          withdrawals: [
            {
              index: "0x0",
              validatorIndex: "0xffff",
              address: "0x0200000000000000000000000000000000000000",
              amount: "0x7b",
            },
          ],
        },
        null, // null returned for missing blocks
        {
          transactions: [
            "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
            "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
          ],
          withdrawals: null, // withdrawals is null pre-capella
        },
      ],
    };

    const request = {
      jsonrpc: "2.0",
      method: "engine_getPayloadBodiesByRangeV1",
      params: [numToQuantity(startBlockNumber), numToQuantity(blockCount)],
    };

    returnValue = response;

    const res = await executionEngine.getPayloadBodiesByRange(ForkName.bellatrix, startBlockNumber, blockCount);

    expect(reqJsonRpcPayload).toEqual(request);
    expect(res.map(serializeExecutionPayloadBody)).toEqual(response.result);
  });

  it("error - unknown payload", async () => {
    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_getPayload","params":["0x123"],"id":67}' http://localhost:8545
     */

    const request = {jsonrpc: "2.0", method: "engine_getPayload", params: ["0x123"]};
    const response = {jsonrpc: "2.0", id: 67, error: {code: 5, message: "unknown payload"}};
    returnValue = response;

    await expect(executionEngine.getPayload(ForkName.bellatrix, request.params[0])).rejects.toThrow(
      "JSON RPC error: unknown payload, engine_getPayload"
    );
  });
});
