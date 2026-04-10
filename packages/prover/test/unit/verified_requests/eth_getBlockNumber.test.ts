import {describe, expect, it, vi} from "vitest";
import {getEmptyLogger} from "@lodestar/logger/empty";
import {VERIFICATION_FAILED_RESPONSE_CODE} from "../../../src/constants.js";
import {ProofProvider} from "../../../src/proof_provider/proof_provider.js";
import {getVerificationFailedMessage} from "../../../src/utils/json_rpc.js";
import {eth_getBlockNumber} from "../../../src/verified_requests/eth_getBlockNumber.js";

describe("verified_requests / eth_getBlockNumber", () => {
  it("should return the valid json-rpc response with the latest block number", async () => {
    const expectedBlockNumber = 1234567;
    const options = {
      logger: getEmptyLogger(),
      proofProvider: {
        getExecutionPayload: vi.fn().mockResolvedValue({blockNumber: expectedBlockNumber}),
      } as unknown as ProofProvider,
      rpc: {
        request: vi.fn(),
        batchRequest: vi.fn(),
        getRequestId: () => (Math.random() * 10000).toFixed(0),
      },
    };

    const response = await eth_getBlockNumber({
      ...options,
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBlockNumber",
        params: [] as [],
      },
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: "0x12d687",
    });
    expect(options.proofProvider.getExecutionPayload).toHaveBeenCalledWith("latest");
  });

  it("should return the json-rpc response with error when no latest payload is available", async () => {
    const options = {
      logger: getEmptyLogger(),
      proofProvider: {
        getExecutionPayload: vi.fn().mockRejectedValue(new Error("No latest payload")),
      } as unknown as ProofProvider,
      rpc: {
        request: vi.fn(),
        batchRequest: vi.fn(),
        getRequestId: () => (Math.random() * 10000).toFixed(0),
      },
    };

    const response = await eth_getBlockNumber({
      ...options,
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "eth_getBlockNumber",
        params: [] as [],
      },
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: VERIFICATION_FAILED_RESPONSE_CODE,
        message: getVerificationFailedMessage("eth_getBlockNumber"),
      },
    });
  });
});
