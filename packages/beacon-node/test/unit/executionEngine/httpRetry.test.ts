import {expect} from "chai";
import {fastify} from "fastify";

import {fromHexString} from "@chainsafe/ssz";

import {ExecutionEngineHttp, defaultExecutionEngineHttpOpts} from "../../../src/execution/engine/http.js";

import {bytesToData, numToQuantity} from "../../../src/eth1/provider/utils.js";

describe("ExecutionEngine / http ", () => {
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
  let baseUrl: string;
  let errorResponsesBeforeSuccess = 0;
  let controller: AbortController;

  before("Prepare server", async () => {
    controller = new AbortController();
    const server = fastify({logger: false});

    server.post("/", async (req) => {
      if (errorResponsesBeforeSuccess === 0) {
        reqJsonRpcPayload = req.body;
        delete (reqJsonRpcPayload as {id?: number}).id;
        return returnValue;
      } else {
        --errorResponsesBeforeSuccess;
        throw Error(`Will succeed after ${errorResponsesBeforeSuccess} more attempts`);
      }
    });

    afterCallbacks.push(async () => {
      controller.abort();
      await server.close();
    });

    baseUrl = await server.listen(0);

    executionEngine = new ExecutionEngineHttp(
      {
        urls: [baseUrl],
        retryAttempts: defaultExecutionEngineHttpOpts.retryAttempts,
        retryDelay: defaultExecutionEngineHttpOpts.retryDelay,
      },
      {signal: controller.signal}
    );
  });

  describe("notifyForkchoiceUpdate", function () {
    it("notifyForkchoiceUpdate no retry when no pay load attributes", async function () {
      errorResponsesBeforeSuccess = 2;
      const forkChoiceHeadData = {
        headBlockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
        safeBlockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
        finalizedBlockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
      };

      returnValue = {
        jsonrpc: "2.0",
        id: 67,
        result: {payloadStatus: {status: "VALID", latestValidHash: null, validationError: null}, payloadId: "0x"},
      };

      expect(errorResponsesBeforeSuccess).to.be.equal(2, "errorResponsesBeforeSuccess should be 2 before request");
      try {
        await executionEngine.notifyForkchoiceUpdate(
          forkChoiceHeadData.headBlockHash,
          forkChoiceHeadData.safeBlockHash,
          forkChoiceHeadData.finalizedBlockHash
        );
      } catch (err) {
        expect(err).to.be.instanceOf(Error);
      }
      expect(errorResponsesBeforeSuccess).to.be.equal(
        1,
        "errorResponsesBeforeSuccess no retry should be decremented once"
      );
    });

    it("notifyForkchoiceUpdate with retry when pay load attributes", async function () {
      this.timeout("10 min");

      errorResponsesBeforeSuccess = defaultExecutionEngineHttpOpts.retryAttempts - 1;
      const forkChoiceHeadData = {
        headBlockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
        safeBlockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
        finalizedBlockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
      };
      const payloadAttributes = {
        timestamp: 1647036763,
        prevRandao: fromHexString("0x0000000000000000000000000000000000000000000000000000000000000000"),
        suggestedFeeRecipient: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
      };

      const request = {
        jsonrpc: "2.0",
        method: "engine_forkchoiceUpdatedV1",
        params: [
          forkChoiceHeadData,
          {
            timestamp: numToQuantity(payloadAttributes.timestamp),
            prevRandao: bytesToData(payloadAttributes.prevRandao),
            suggestedFeeRecipient: payloadAttributes.suggestedFeeRecipient,
          },
        ],
      };
      returnValue = {
        jsonrpc: "2.0",
        id: 67,
        result: {
          payloadStatus: {status: "VALID", latestValidHash: null, validationError: null},
          payloadId: Buffer.alloc(8, 1),
        },
      };

      expect(errorResponsesBeforeSuccess).to.not.be.equal(
        0,
        "errorResponsesBeforeSuccess should not be zero before request"
      );
      await executionEngine.notifyForkchoiceUpdate(
        forkChoiceHeadData.headBlockHash,
        forkChoiceHeadData.safeBlockHash,
        forkChoiceHeadData.finalizedBlockHash,
        payloadAttributes
      );

      expect(reqJsonRpcPayload).to.deep.equal(request, "Wrong request JSON RPC payload");
      expect(errorResponsesBeforeSuccess).to.be.equal(
        0,
        "errorResponsesBeforeSuccess should be zero after request with retries"
      );
    });
  });
});
