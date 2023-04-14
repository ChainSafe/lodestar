import {expect} from "chai";
import sinon from "sinon";
import deepmerge from "deepmerge";
import {createForkConfig} from "@lodestar/config";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {Logger} from "@lodestar/utils";
import {UNVERIFIED_RESPONSE_CODE} from "../../../src/constants.js";
import {ELVerifiedRequestHandlerOpts} from "../../../src/interfaces.js";
import {eth_getBalance} from "../../../src/verified_requests/eth_getBalance.js";
import eth_getBalance_eoa from "../../fixtures/sepolia/eth_getBalance_eoa_proof.json" assert {type: "json"};
import eth_getBalance_contract from "../../fixtures/sepolia/eth_getBalance_contract_proof.json" assert {type: "json"};
import {createMockLogger} from "../../mocks/logger_mock.js";

const testCases = [eth_getBalance_eoa, eth_getBalance_contract];

describe("verified_requests / eth_getBalance", () => {
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

        options.handler.resolves(testCase.response);
        options.proofProvider.getExecutionPayload.resolves(executionPayload);

        const result = await eth_getBalance({
          ...options,
          payload: {
            ...testCase.request,
            method: "eth_getBalance",
            params: [testCase.request.params[0], "latest"],
          },
          network: testCase.network,
        } as unknown as ELVerifiedRequestHandlerOpts<[address: string, block?: string | number | undefined], string>);

        expect(result).to.eql({...result, result: testCase.response.result.balance});
      });

      it("should return the json-rpc response with error for an invalid account", async () => {
        const config = createForkConfig(networksChainConfig[testCase.network as NetworkName]);
        const executionPayload = config
          .getExecutionForkTypes(parseInt(testCase.headers.header.message.slot))
          .ExecutionPayload.fromJson(testCase.executionPayload);

        const response = deepmerge({}, testCase.response);
        // Change the proof to be invalidated with state
        delete response.result.accountProof[0];

        options.handler.resolves(response);
        options.proofProvider.getExecutionPayload.resolves(executionPayload);

        const result = await eth_getBalance({
          ...options,
          payload: {
            ...testCase.request,
            method: "eth_getBalance",
            params: [testCase.request.params[0], "latest"],
          },
          network: testCase.network,
        } as unknown as ELVerifiedRequestHandlerOpts<[address: string, block?: string | number | undefined], string>);

        expect(result).to.eql({
          jsonrpc: "2.0",
          id: testCase.request.id,
          error: {code: UNVERIFIED_RESPONSE_CODE, message: "eth_getBalance request can not be verified."},
        });
      });
    });
  }
});
