import {expect} from "chai";
import deepmerge from "deepmerge";
import {createForkConfig} from "@lodestar/config";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {ELTransaction} from "../../../lib/types.js";
import {UNVERIFIED_RESPONSE_CODE} from "../../../src/constants.js";
import {eth_call} from "../../../src/verified_requests/eth_call.js";
import ethCallCase1 from "../../fixtures/mainnet/eth_call.json" assert {type: "json"};
import {generateReqHandlerOptionsMock} from "../../mocks/request_handler.js";
import {JsonRpcRequest, JsonRpcResponseWithResultPayload} from "../../../src/types.js";

const testCases = [ethCallCase1];

describe("verified_requests / eth_call", () => {
  for (const t of testCases) {
    describe(t.label, () => {
      it("should return the valid json-rpc response for a valid call", async () => {
        const testCase = deepmerge({}, t);

        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const options = generateReqHandlerOptionsMock(testCase, config);

        const response = await eth_call({
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
        const options = generateReqHandlerOptionsMock(testCase, config);

        const response = await eth_call({
          ...options,
          payload: {
            ...testCase.request,
            params: testCase.request.params as [ELTransaction, string],
          },
        });

        expect(response).to.eql({
          jsonrpc: "2.0",
          id: testCase.request.id,
          error: {code: UNVERIFIED_RESPONSE_CODE, message: "eth_call request can not be verified."},
        });
      });
    });
  }
});
