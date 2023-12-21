import {describe, it, expect} from "vitest";
import {createForkConfig} from "@lodestar/config";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {ELTransaction} from "../../../lib/types.js";
import {VERIFICATION_FAILED_RESPONSE_CODE} from "../../../src/constants.js";
import {eth_estimateGas} from "../../../src/verified_requests/eth_estimateGas.js";
import ethEstimateGasCase1 from "../../fixtures/mainnet/eth_estimateGas_simple_transfer.json" assert {type: "json"};
import ethEstimateGasCase2 from "../../fixtures/mainnet/eth_estimateGas_contract_call.json" assert {type: "json"};
import {TestFixture, cloneTestFixture, generateReqHandlerOptionsMock} from "../../mocks/request_handler.js";
import {JsonRpcRequest, JsonRpcResponseWithResultPayload} from "../../../src/types.js";
import {getVerificationFailedMessage} from "../../../src/utils/json_rpc.js";

const testCases = [ethEstimateGasCase1, ethEstimateGasCase2] as TestFixture[];

describe("verified_requests / eth_estimateGas", () => {
  for (const t of testCases) {
    describe(t.label, () => {
      it("should return the valid json-rpc response for a valid call", async () => {
        const testCase = cloneTestFixture(t);

        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const options = generateReqHandlerOptionsMock(testCase as any, config);

        const response = await eth_estimateGas({
          ...options,
          payload: {
            ...testCase.request,
            params: testCase.request.params as [ELTransaction, string],
          },
        });

        expect(response).toEqual(testCase.response);
      });

      it("should return the json-rpc response with error for an invalid call", async () => {
        const testCase = cloneTestFixture(t);

        // Temper the responses to make them invalid
        // Temper the responses to make them invalid
        for (const {payload, response} of testCase.dependentRequests) {
          if (!Array.isArray(payload) || !Array.isArray(response)) continue;

          for (const [index, tx] of payload.entries()) {
            if ((tx as JsonRpcRequest).method === "eth_getCode") {
              const res = response[index] as JsonRpcResponseWithResultPayload<string>;
              res.result = `${res.result as string}12`;
            }
          }
        }

        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const options = generateReqHandlerOptionsMock(testCase as any, config);

        const response = await eth_estimateGas({
          ...options,
          payload: {
            ...testCase.request,
            params: testCase.request.params as [ELTransaction, string],
          },
        });

        expect(response).toEqual({
          jsonrpc: "2.0",
          id: testCase.request.id,
          error: {code: VERIFICATION_FAILED_RESPONSE_CODE, message: getVerificationFailedMessage("eth_estimateGas")},
        });
      });
    });
  }
});
