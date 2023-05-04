import {expect} from "chai";
import sinon from "sinon";
import deepmerge from "deepmerge";
import {createForkConfig} from "@lodestar/config";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {Logger} from "@lodestar/utils";
import {UNVERIFIED_RESPONSE_CODE} from "../../../src/constants.js";
import {ELVerifiedRequestHandlerOpts} from "../../../src/interfaces.js";
import {ELBlock} from "../../../src/types.js";
import {eth_getBlockByHash} from "../../../src/verified_requests/eth_getBlockByHash.js";
import eth_getBlock_with_contractCreation from "../../fixtures/sepolia/eth_getBlock_with_contractCreation.json" assert {type: "json"};
import eth_getBlock_with_no_accessList from "../../fixtures/sepolia/eth_getBlock_with_no_accessList.json" assert {type: "json"};
import {createMockLogger} from "../../mocks/logger_mock.js";

const testCases = [eth_getBlock_with_no_accessList, eth_getBlock_with_contractCreation];

describe("verified_requests / eth_getBlockByHash", () => {
  let options: {handler: sinon.SinonStub; logger: Logger; proofProvider: {getExecutionPayload: sinon.SinonStub}};

  beforeEach(() => {
    options = {
      handler: sinon.stub(),
      logger: createMockLogger(),
      proofProvider: {getExecutionPayload: sinon.stub()},
    };
  });

  for (const testCase of testCases) {
    describe(testCase.label, () => {
      it("should return the valid json-rpc response for a valid block", async () => {
        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const executionPayload = config
          .getExecutionForkTypes(parseInt(testCase.headers.header.message.slot))
          .ExecutionPayload.fromJson(testCase.executionPayload);

        options.handler.resolves(testCase.response);
        options.proofProvider.getExecutionPayload.resolves(executionPayload);

        const result = await eth_getBlockByHash({
          ...options,
          payload: testCase.request,
          network: testCase.network,
        } as unknown as ELVerifiedRequestHandlerOpts<[block: string, hydrated: boolean], ELBlock>);

        expect(result).to.eql(testCase.response);
      });

      it("should return the json-rpc response with error for an invalid block header with valid execution payload", async () => {
        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const executionPayload = config
          .getExecutionForkTypes(parseInt(testCase.headers.header.message.slot))
          .ExecutionPayload.fromJson(testCase.executionPayload);

        const temperedResponse = {
          ...testCase.response,
          result: {
            ...testCase.response.result,
            parentHash: "0xbdbd90ab601a073c3d128111eafb12fa7ece4af239abdc8be60184a08c6d7ef4",
          },
        };

        options.handler.resolves(temperedResponse);
        options.proofProvider.getExecutionPayload.resolves(executionPayload);

        const result = await eth_getBlockByHash({
          ...options,
          payload: testCase.request,
          network: testCase.network,
        } as unknown as ELVerifiedRequestHandlerOpts<[block: string, hydrated: boolean], ELBlock>);

        expect(result).to.eql({
          jsonrpc: "2.0",
          id: testCase.request.id,
          error: {code: UNVERIFIED_RESPONSE_CODE, message: "eth_getBlockByHash request can not be verified."},
        });
      });

      it("should return the json-rpc response with error for an invalid block body with valid execution payload", async () => {
        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const executionPayload = config
          .getExecutionForkTypes(parseInt(testCase.headers.header.message.slot))
          .ExecutionPayload.fromJson(testCase.executionPayload);

        const temperedResponse = deepmerge<typeof testCase.response, unknown>(testCase.response, {});
        temperedResponse.result.transactions[0].to = "0xd86e1fedb1120369ff5175b74f4413cb74fcacdb";

        options.handler.resolves(temperedResponse);
        options.proofProvider.getExecutionPayload.resolves(executionPayload);

        const result = await eth_getBlockByHash({
          ...options,
          payload: testCase.request,
          network: testCase.network,
        } as unknown as ELVerifiedRequestHandlerOpts<[block: string, hydrated: boolean], ELBlock>);

        expect(result).to.eql({
          jsonrpc: "2.0",
          id: testCase.request.id,
          error: {code: UNVERIFIED_RESPONSE_CODE, message: "eth_getBlockByHash request can not be verified."},
        });
      });

      it("should return the json-rpc response with error for an valid block with invalid execution payload", async () => {
        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const temperedPayload = {
          ...testCase.executionPayload,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          parent_hash: "0xbdbd90ab601a073c3d128111eafb12fa7ece4af239abdc8be60184a08c6d7ef4",
        };

        const executionPayload = config
          .getExecutionForkTypes(parseInt(testCase.headers.header.message.slot))
          .ExecutionPayload.fromJson(temperedPayload);

        options.handler.resolves(testCase.response);
        options.proofProvider.getExecutionPayload.resolves(executionPayload);

        const result = await eth_getBlockByHash({
          ...options,
          payload: testCase.request,
          network: testCase.network,
        } as unknown as ELVerifiedRequestHandlerOpts<[block: string, hydrated: boolean], ELBlock>);

        expect(result).to.eql({
          jsonrpc: "2.0",
          id: testCase.request.id,
          error: {code: UNVERIFIED_RESPONSE_CODE, message: "eth_getBlockByHash request can not be verified."},
        });
      });
    });
  }
});
