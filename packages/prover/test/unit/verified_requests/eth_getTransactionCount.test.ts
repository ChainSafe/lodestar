import {expect} from "chai";
import {ELVerifiedRequestHandlerOpts} from "../../../src/interfaces.js";
import {createMockLogger} from "../../mocks/logger_mock.js";
import {createProofProviderMock} from "../../mocks/proof_provider_mock.js";
import {createELRequestHandlerMock} from "../../mocks/handler_mock.js";
import {invalidAccountProof, validAccountProof} from "../../fixtures/el_proof.js";
import {validExecutionPayload} from "../../fixtures/cl_payload.js";
import {UNVERIFIED_RESPONSE_CODE} from "../../../src/constants.js";
import {eth_getTransactionCount} from "../../../src/verified_requests/eth_getTransactionCount.js";

describe("verified_requests / eth_getTransactionCount", () => {
  it("should return the valid json-rpc response for a valid account", async () => {
    const address = "0xf97e180c050e5ab072211ad2c213eb5aee4df134";
    const opts: ELVerifiedRequestHandlerOpts<[address: string, block?: string | number | undefined]> = {
      handler: createELRequestHandlerMock({accountProof: validAccountProof}),
      logger: createMockLogger(),
      proofProvider: createProofProviderMock({executionPayload: validExecutionPayload}),
      payload: {
        jsonrpc: "2.0",
        id: "1",
        method: "eth_getTransactionCount",
        params: [address, "latest"],
      },
    };

    const result = await eth_getTransactionCount(opts);

    expect(result).to.eql({jsonrpc: "2.0", id: "1", result: validAccountProof.nonce});
  });

  it("should return the json-rpc response with error for an invalid account", async () => {
    const address = "0xf97e180c050e5ab072211ad2c213eb5aee4df134";
    const opts: ELVerifiedRequestHandlerOpts<[address: string, block?: string | number | undefined]> = {
      handler: createELRequestHandlerMock({accountProof: invalidAccountProof}),
      logger: createMockLogger(),
      proofProvider: createProofProviderMock({executionPayload: validExecutionPayload}),
      payload: {
        jsonrpc: "2.0",
        id: "1",
        method: "eth_getTransactionCount",
        params: [address, "latest"],
      },
    };

    const result = await eth_getTransactionCount(opts);

    expect(result).to.eql({
      jsonrpc: "2.0",
      id: "1",
      error: {code: UNVERIFIED_RESPONSE_CODE, message: "eth_getTransactionCount request can not be verified."},
    });
  });
});
