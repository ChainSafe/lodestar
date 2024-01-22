import {describe, it, expect} from "vitest";
import {createForkConfig} from "@lodestar/config";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {VERIFICATION_FAILED_RESPONSE_CODE} from "../../../src/constants.js";
import {ELBlock} from "../../../src/types.js";
import {eth_getBlockByNumber} from "../../../src/verified_requests/eth_getBlockByNumber.js";
import eth_getBlock_with_contractCreation from "../../fixtures/sepolia/eth_getBlock_with_contractCreation.json" assert {type: "json"};
import eth_getBlock_with_no_accessList from "../../fixtures/sepolia/eth_getBlock_with_no_accessList.json" assert {type: "json"};
import {TestFixture, cloneTestFixture, generateReqHandlerOptionsMock} from "../../mocks/request_handler.js";
import {getVerificationFailedMessage} from "../../../src/utils/json_rpc.js";

const testCases = [eth_getBlock_with_no_accessList, eth_getBlock_with_contractCreation] as [
  TestFixture<ELBlock>,
  TestFixture<ELBlock>,
];

describe("verified_requests / eth_getBlockByNumber", () => {
  for (const t of testCases) {
    describe(t.label, () => {
      it("should return the valid json-rpc response for a valid block", async () => {
        const testCase = cloneTestFixture(t);
        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const options = generateReqHandlerOptionsMock(testCase, config);

        const response = await eth_getBlockByNumber({
          ...options,
          payload: {
            ...testCase.request,
            params: testCase.request.params as [string | number, boolean],
          },
        });
        expect(response).toEqual(testCase.response);
      });

      it("should return the json-rpc response with error for an invalid block header with valid execution payload", async () => {
        // Temper the block body
        const testCase = cloneTestFixture(t, {
          execution: {block: {parentHash: "0xbdbd90ab601a073c3d128111eafb12fa7ece4af239abdc8be60184a08c6d7ef4"}},
        });
        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const options = generateReqHandlerOptionsMock(testCase, config);

        const response = await eth_getBlockByNumber({
          ...options,
          payload: {
            ...testCase.request,
            params: testCase.request.params as [string | number, boolean],
          },
        });

        expect(response).toEqual({
          jsonrpc: "2.0",
          id: testCase.request.id,
          error: {
            code: VERIFICATION_FAILED_RESPONSE_CODE,
            message: getVerificationFailedMessage("eth_getBlockByNumber"),
          },
        });
      });

      it("should return the json-rpc response with error for an invalid block body with valid execution payload", async () => {
        // Temper the block body
        const testCase = cloneTestFixture(t, {
          execution: {block: {transactions: [{to: "0xd86e1fedb1120369ff5175b74f4413cb74fcacdb"}]}},
        });
        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const options = generateReqHandlerOptionsMock(testCase, config);

        const response = await eth_getBlockByNumber({
          ...options,
          payload: {
            ...testCase.request,
            params: testCase.request.params as [string | number, boolean],
          },
        });

        expect(response).toEqual({
          jsonrpc: "2.0",
          id: testCase.request.id,
          error: {
            code: VERIFICATION_FAILED_RESPONSE_CODE,
            message: getVerificationFailedMessage("eth_getBlockByNumber"),
          },
        });
      });

      it("should return the json-rpc response with error for an valid block with invalid execution payload", async () => {
        // Temper the execution payload
        const testCase = cloneTestFixture(t, {
          beacon: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            executionPayload: {parent_hash: "0xbdbd90ab601a073c3d128111eafb12fa7ece4af239abdc8be60184a08c6d7ef4"},
          },
        });
        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const options = generateReqHandlerOptionsMock(testCase, config);

        const response = await eth_getBlockByNumber({
          ...options,
          payload: {
            ...testCase.request,
            params: testCase.request.params as [string | number, boolean],
          },
        });

        expect(response).toEqual({
          jsonrpc: "2.0",
          id: testCase.request.id,
          error: {
            code: VERIFICATION_FAILED_RESPONSE_CODE,
            message: getVerificationFailedMessage("eth_getBlockByNumber"),
          },
        });
      });
    });
  }
});
