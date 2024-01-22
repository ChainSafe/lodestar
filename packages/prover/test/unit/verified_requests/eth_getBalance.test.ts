import {describe, it, expect} from "vitest";
import {createForkConfig} from "@lodestar/config";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {VERIFICATION_FAILED_RESPONSE_CODE} from "../../../src/constants.js";
import {eth_getBalance} from "../../../src/verified_requests/eth_getBalance.js";
import eth_getBalance_eoa from "../../fixtures/sepolia/eth_getBalance_eoa.json" assert {type: "json"};
import eth_getBalance_contract from "../../fixtures/sepolia/eth_getBalance_contract.json" assert {type: "json"};
import {cloneTestFixture, generateReqHandlerOptionsMock} from "../../mocks/request_handler.js";
import {getVerificationFailedMessage} from "../../../src/utils/json_rpc.js";

const testCases = [eth_getBalance_eoa, eth_getBalance_contract];

describe("verified_requests / eth_getBalance", () => {
  for (const testCase of testCases) {
    describe(testCase.label, () => {
      it("should return the valid json-rpc response for a valid account", async () => {
        const data = cloneTestFixture(testCase);
        const config = createForkConfig(networksChainConfig[data.network as NetworkName]);
        const options = generateReqHandlerOptionsMock(data, config);

        const response = await eth_getBalance({
          ...options,
          payload: {
            ...data.request,
            params: [data.request.params[0], data.request.params[1]],
          },
        });
        expect(response).toEqual(data.response);
      });

      it("should return the json-rpc response with error for an invalid account", async () => {
        const data = cloneTestFixture(testCase);
        // Temporarily remove the accountProof to make the request invalid
        delete data.dependentRequests[0].response.result.accountProof[0];
        const config = createForkConfig(networksChainConfig[data.network as NetworkName]);
        const options = generateReqHandlerOptionsMock(data, config);

        const response = await eth_getBalance({
          ...options,
          payload: {
            ...data.request,
            params: [data.request.params[0], data.request.params[1]],
          },
        });

        expect(response).toEqual({
          jsonrpc: "2.0",
          id: data.request.id,
          error: {code: VERIFICATION_FAILED_RESPONSE_CODE, message: getVerificationFailedMessage("eth_getBalance")},
        });
      });
    });
  }
});
