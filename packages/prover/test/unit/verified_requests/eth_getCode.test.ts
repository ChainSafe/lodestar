import {describe, it, expect} from "vitest";
import {createForkConfig} from "@lodestar/config";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {VERIFICATION_FAILED_RESPONSE_CODE} from "../../../src/constants.js";
import {eth_getCode} from "../../../src/verified_requests/eth_getCode.js";
import ethGetCodeCase1 from "../../fixtures/sepolia/eth_getCode.json" assert {type: "json"};
import {generateReqHandlerOptionsMock, cloneTestFixture} from "../../mocks/request_handler.js";
import {getVerificationFailedMessage} from "../../../src/utils/json_rpc.js";

const testCases = [ethGetCodeCase1];

describe("verified_requests / eth_getCode", () => {
  for (const t of testCases) {
    describe(t.label, () => {
      it("should return the valid json-rpc response for a valid account", async () => {
        const testCase = cloneTestFixture(t);
        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const options = generateReqHandlerOptionsMock(testCase, config);

        const response = await eth_getCode({
          ...options,
          payload: {
            ...testCase.request,
            params: testCase.request.params as [string, string],
          },
        });

        expect(response).toEqual(testCase.response);
      });

      it("should return the json-rpc response with error for an invalid account", async () => {
        const testCase = cloneTestFixture(t, {response: {result: t.response.result + "1234fe"}});
        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const options = generateReqHandlerOptionsMock(testCase, config);

        const response = await eth_getCode({
          ...options,
          payload: {
            ...testCase.request,
            params: testCase.request.params as [string, string],
          },
        });

        expect(response).toEqual({
          jsonrpc: "2.0",
          id: testCase.request.id,
          error: {code: VERIFICATION_FAILED_RESPONSE_CODE, message: getVerificationFailedMessage("eth_getCode")},
        });
      });
    });
  }
});
