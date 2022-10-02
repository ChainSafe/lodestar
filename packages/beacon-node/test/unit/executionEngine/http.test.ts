import {expect} from "chai";
import {fastify} from "fastify";
import {
  ExecutionEngineHttp,
  parseExecutionPayload,
  serializeExecutionPayload,
  defaultExecutionEngineHttpOpts,
} from "../../../src/execution/engine/http.js";

describe("ExecutionEngine / http", () => {
  const afterCallbacks: (() => Promise<void> | void)[] = [];
  after(async () => {
    while (afterCallbacks.length > 0) {
      const callback = afterCallbacks.pop();
      if (callback) await callback();
    }
  });

  let executionEngine: ExecutionEngineHttp;
  let returnValue: unknown = {};
  let reqJsonRpcPayload: unknown = {};

  before("Prepare server", async () => {
    const controller = new AbortController();
    const server = fastify({logger: false});

    server.post("/", async (req) => {
      reqJsonRpcPayload = req.body;
      delete (reqJsonRpcPayload as {id?: number}).id;
      return returnValue;
    });

    afterCallbacks.push(async () => {
      controller.abort();
      await server.close();
    });

    const baseUrl = await server.listen(0);

    executionEngine = new ExecutionEngineHttp(
      {
        urls: [baseUrl],
        retryAttempts: defaultExecutionEngineHttpOpts.retryAttempts,
        retryDelay: defaultExecutionEngineHttpOpts.retryDelay,
      },
      {signal: controller.signal}
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

    const payload = await executionEngine.getPayload("0x0");

    expect(serializeExecutionPayload(payload)).to.deep.equal(response.result, "Wrong returned payload");
    expect(reqJsonRpcPayload).to.deep.equal(request, "Wrong request JSON RPC payload");
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

    const {status} = await executionEngine.notifyNewPayload(parseExecutionPayload(request.params[0]));

    expect(status).to.equal("VALID", "Wrong returned execute payload result");
    expect(reqJsonRpcPayload).to.deep.equal(request, "Wrong request JSON RPC payload");
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
      forkChoiceHeadData.headBlockHash,
      forkChoiceHeadData.safeBlockHash,
      forkChoiceHeadData.finalizedBlockHash
    );

    expect(reqJsonRpcPayload).to.deep.equal(request, "Wrong request JSON RPC payload");
  });

  it("error - unknown payload", async () => {
    /**
     * curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"engine_getPayload","params":["0x123"],"id":67}' http://localhost:8545
     */

    const request = {jsonrpc: "2.0", method: "engine_getPayload", params: ["0x123"]};
    const response = {jsonrpc: "2.0", id: 67, error: {code: 5, message: "unknown payload"}};
    returnValue = response;

    await expect(executionEngine.getPayload(request.params[0])).to.be.rejectedWith(
      "JSON RPC error: unknown payload, engine_getPayload"
    );
  });
});
