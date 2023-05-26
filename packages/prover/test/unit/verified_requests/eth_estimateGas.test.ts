import {expect} from "chai";
import deepmerge from "deepmerge";
import {createForkConfig} from "@lodestar/config";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {ELTransaction} from "../../../lib/types.js";
import {UNVERIFIED_RESPONSE_CODE} from "../../../src/constants.js";
import {eth_estimateGas} from "../../../src/verified_requests/eth_estimateGas.js";
import ethEstimateGasCase1 from "../../fixtures/mainnet/eth_estimateGas_simple_transfer.json" assert {type: "json"};
import ethEstimateGasCase2 from "../../fixtures/mainnet/eth_estimateGas_contract_call.json" assert {type: "json"};
import {TestFixture, generateReqHandlerOptionsMock} from "../../mocks/request_handler.js";

const testCases = [ethEstimateGasCase1, ethEstimateGasCase2] as TestFixture[];

describe("verified_requests / eth_estimateGas", () => {
  for (const t of testCases) {
    describe(t.label, () => {
      it("should return the valid json-rpc response for a valid call", async () => {
        const testCase = deepmerge({}, t);

        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const options = generateReqHandlerOptionsMock(testCase, config);

        const response = await eth_estimateGas({
          ...options,
          payload: {
            ...testCase.request,
            params: testCase.request.params as [ELTransaction, string],
          },
        });

        expect(response).to.eql(testCase.response);
      });

      it("should return the json-rpc response with error for an invalid call", async () => {
        const testCase = deepmerge(t, {});

        // Temper the responses to make them invalid
        for (const tx of testCase.dependentRequests) {
          if (tx.payload.method === "eth_getCode") {
            tx.response.result = `${tx.response.result}12`;
          }
        }

        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const options = generateReqHandlerOptionsMock(testCase, config);

        const response = await eth_estimateGas({
          ...options,
          payload: {
            ...testCase.request,
            params: testCase.request.params as [ELTransaction, string],
          },
        });

        expect(response).to.eql({
          jsonrpc: "2.0",
          id: testCase.request.id,
          error: {code: UNVERIFIED_RESPONSE_CODE, message: "eth_estimateGas request can not be verified."},
        });
      });
    });
  }
});
