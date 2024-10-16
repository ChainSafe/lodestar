import {fastify} from "fastify";
import {fromHexString} from "@chainsafe/ssz";
import {describe, it, expect, beforeAll, afterAll} from "vitest";
import {ForkName} from "@lodestar/params";
import {Logger} from "@lodestar/logger";
import {defaultExecutionEngineHttpOpts} from "../../../src/execution/engine/http.js";
import {bytesToData, numToQuantity} from "../../../src/eth1/provider/utils.js";
import {IExecutionEngine, initializeExecutionEngine, PayloadAttributes} from "../../../src/execution/index.js";

describe("ExecutionEngine / http ", () => {
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
  let baseUrl: string;
  let errorResponsesBeforeSuccess = 0;
  let controller: AbortController;

  beforeAll(async () => {
    controller = new AbortController();
    const server = fastify({logger: false});

    server.post("/", async (req) => {
      if (errorResponsesBeforeSuccess === 0) {
        reqJsonRpcPayload = req.body;
        delete (reqJsonRpcPayload as {id?: number}).id;
        return returnValue;
      }

      --errorResponsesBeforeSuccess;
      throw Error(`Will succeed after ${errorResponsesBeforeSuccess} more attempts`);
    });

    afterCallbacks.push(async () => {
      controller.abort();
      await server.close();
    });

    baseUrl = await server.listen({port: 0});

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

  describe("notifyForkchoiceUpdate", () => {
    it("notifyForkchoiceUpdate no retry when no pay load attributes", async () => {
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

      expect(errorResponsesBeforeSuccess).toBe(2);
      try {
        await executionEngine.notifyForkchoiceUpdate(
          ForkName.bellatrix,
          forkChoiceHeadData.headBlockHash,
          forkChoiceHeadData.safeBlockHash,
          forkChoiceHeadData.finalizedBlockHash
        );
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
      }
      expect(errorResponsesBeforeSuccess).toBe(1);
    });

    it("notifyForkchoiceUpdate with retry when pay load attributes", async () => {
      errorResponsesBeforeSuccess = defaultExecutionEngineHttpOpts.retries - 1;
      const forkChoiceHeadData = {
        headBlockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
        safeBlockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
        finalizedBlockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
      };
      const payloadAttributes: PayloadAttributes = {
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

      expect(errorResponsesBeforeSuccess).not.toBe(0);
      await executionEngine.notifyForkchoiceUpdate(
        ForkName.bellatrix,
        forkChoiceHeadData.headBlockHash,
        forkChoiceHeadData.safeBlockHash,
        forkChoiceHeadData.finalizedBlockHash,
        payloadAttributes
      );

      expect(reqJsonRpcPayload).toEqual(request);
      expect(errorResponsesBeforeSuccess).toBe(0);
    });
  });
});
