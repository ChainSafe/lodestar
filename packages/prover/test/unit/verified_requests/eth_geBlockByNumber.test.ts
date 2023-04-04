import {expect} from "chai";
import {ELVerifiedRequestHandlerOpts} from "../../../src/interfaces.js";
import {createMockLogger} from "../../mocks/logger_mock.js";
import {createProofProviderMock} from "../../mocks/proof_provider_mock.js";
import {createELRequestHandlerMock} from "../../mocks/handler_mock.js";
import {validExecutionPayload} from "../../fixtures/cl_payload.js";
import {UNVERIFIED_RESPONSE_CODE} from "../../../src/constants.js";
import {ELBlock} from "../../../src/types.js";
import {invalidELBlock, validELBlock} from "../../fixtures/el_blocks.js";
import {hexToBuffer} from "../../../src/utils/conversion.js";
import {eth_getBlockByNumber} from "../../../src/verified_requests/eth_getBlockByNumber.js";

describe("verified_requests / eth_getBlockByNumber", () => {
  it("should return the valid json-rpc response for a valid block", async () => {
    const blockNumber = validELBlock.number;
    const opts: ELVerifiedRequestHandlerOpts<[block: string | number, hydrated: boolean], ELBlock> = {
      handler: createELRequestHandlerMock({block: validELBlock}),
      logger: createMockLogger(),
      proofProvider: createProofProviderMock({
        executionPayload: {...validExecutionPayload, blockHash: hexToBuffer(validELBlock.hash)},
      }),
      payload: {
        jsonrpc: "2.0",
        id: "1",
        method: "eth_getBlockByNumber",
        params: [blockNumber, true],
      },
    };

    const result = await eth_getBlockByNumber(opts);

    expect(result).to.eql({jsonrpc: "2.0", id: "1", result: validELBlock});
  });

  it("should return the json-rpc response with error for an invalid block with valid block hash", async () => {
    const blockNumber = validELBlock.number;
    const opts: ELVerifiedRequestHandlerOpts<[block: string | number, hydrated: boolean], ELBlock> = {
      handler: createELRequestHandlerMock({block: invalidELBlock}),
      logger: createMockLogger(),
      proofProvider: createProofProviderMock({
        executionPayload: {...validExecutionPayload, blockHash: hexToBuffer(validELBlock.hash)},
      }),
      payload: {
        jsonrpc: "2.0",
        id: "1",
        method: "eth_getBlockByNumber",
        params: [blockNumber, true],
      },
    };

    const result = await eth_getBlockByNumber(opts);

    expect(result).to.eql({
      jsonrpc: "2.0",
      id: "1",
      error: {code: UNVERIFIED_RESPONSE_CODE, message: "eth_getBlockByNumber request can not be verified."},
    });
  });

  it("should return the json-rpc response with error for an valid block with invalid block hash", async () => {
    const blockNumber = validELBlock.number;
    const opts: ELVerifiedRequestHandlerOpts<[block: string | number, hydrated: boolean], ELBlock> = {
      handler: createELRequestHandlerMock({block: validELBlock}),
      logger: createMockLogger(),
      proofProvider: createProofProviderMock({
        executionPayload: {...validExecutionPayload, blockHash: hexToBuffer(invalidELBlock.hash)},
      }),
      payload: {
        jsonrpc: "2.0",
        id: "1",
        method: "eth_getBlockByNumber",
        params: [blockNumber, true],
      },
    };

    const result = await eth_getBlockByNumber(opts);

    expect(result).to.eql({
      jsonrpc: "2.0",
      id: "1",
      error: {code: UNVERIFIED_RESPONSE_CODE, message: "eth_getBlockByNumber request can not be verified."},
    });
  });
});
