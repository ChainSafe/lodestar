import {expect} from "chai";
import sinon from "sinon";
import deepmerge from "deepmerge";
import {createForkConfig} from "@lodestar/config";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {Logger} from "@lodestar/utils";
import {UNVERIFIED_RESPONSE_CODE} from "../../../src/constants.js";
import {ELVerifiedRequestHandlerOpts} from "../../../src/interfaces.js";
import {eth_getCode} from "../../../src/verified_requests/eth_getCode.js";
import eth_getCodeCase1 from "../../fixtures/sepolia/eth_getCode.json" assert {type: "json"};
import ethContractProof from "../../fixtures/sepolia/eth_getBalance_contract_proof.json" assert {type: "json"};
import {createMockLogger} from "../../mocks/logger_mock.js";

const testCases = [eth_getCodeCase1];

describe("verified_requests / eth_getCode", () => {
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
      it("should return the valid json-rpc response for a valid account", async () => {
        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const executionPayload = config
          .getExecutionForkTypes(parseInt(testCase.headers.header.message.slot))
          .ExecutionPayload.fromJson(testCase.executionPayload);

        options.handler.onFirstCall().resolves(ethContractProof.response);
        options.handler.onSecondCall().resolves(testCase.response);
        options.proofProvider.getExecutionPayload.resolves(executionPayload);

        const result = await eth_getCode({
          ...options,
          payload: testCase.request,
          network: testCase.network,
        } as unknown as ELVerifiedRequestHandlerOpts<[address: string, block?: string | number | undefined], string>);

        expect(result).to.eql(testCase.response);
      });

      it("should return the json-rpc response with error for an invalid account", async () => {
        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const executionPayload = config
          .getExecutionForkTypes(parseInt(testCase.headers.header.message.slot))
          .ExecutionPayload.fromJson(testCase.executionPayload);

        const temperedResponse = deepmerge({}, testCase.response);
        temperedResponse.result = temperedResponse.result + "1234fe";

        options.handler.onFirstCall().resolves(ethContractProof.response);
        options.handler.onSecondCall().resolves(temperedResponse);
        options.proofProvider.getExecutionPayload.resolves(executionPayload);

        const result = await eth_getCode({
          ...options,
          payload: testCase.request,
          network: testCase.network,
        } as unknown as ELVerifiedRequestHandlerOpts<[address: string, block?: string | number | undefined], string>);

        expect(result).to.eql({
          jsonrpc: "2.0",
          id: testCase.request.id,
          error: {code: UNVERIFIED_RESPONSE_CODE, message: "eth_getCode request can not be verified."},
        });
      });
    });
  }
});
