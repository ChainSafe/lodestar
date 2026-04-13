import {describe, expect, it, vi} from "vitest";
import {getEmptyLogger} from "@lodestar/logger/empty";
import {VERIFICATION_FAILED_RESPONSE_CODE} from "../../../src/constants.js";
import {ProofProvider} from "../../../src/proof_provider/proof_provider.js";
import {getVerificationFailedMessage} from "../../../src/utils/json_rpc.js";
import {ELRpcProvider} from "../../../src/utils/rpc_provider.js";
import {eth_blockNumber} from "../../../src/verified_requests/eth_blockNumber.js";

describe("verified_requests / eth_blockNumber", () => {
  it("should return verified block number when EL is at or ahead of CL", async () => {
    const elBlockNumber = 1234567;
    const clBlockNumber = 1234560;

    const options = {
      logger: getEmptyLogger(),
      proofProvider: {
        getExecutionPayload: vi.fn().mockResolvedValue({blockNumber: clBlockNumber}),
      } as unknown as ProofProvider,
      rpc: {
        request: vi.fn().mockResolvedValue({
          jsonrpc: "2.0",
          id: "1",
          result: "0x12d687", // 1234567
        }),
        batchRequest: vi.fn(),
        getRequestId: () => (Math.random() * 10000).toFixed(0),
      } as unknown as ELRpcProvider,
    };

    const response = await eth_blockNumber({
      ...options,
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: [] as [],
      },
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: "0x12d687",
    });
    expect(options.rpc.request).toHaveBeenCalledWith("eth_blockNumber", [], {raiseError: false});
    expect(options.proofProvider.getExecutionPayload).toHaveBeenCalledWith("latest");
  });

  it("should return error when EL block number is behind CL", async () => {
    const elBlockNumber = 1000;
    const clBlockNumber = 2000;

    const options = {
      logger: getEmptyLogger(),
      proofProvider: {
        getExecutionPayload: vi.fn().mockResolvedValue({blockNumber: clBlockNumber}),
      } as unknown as ProofProvider,
      rpc: {
        request: vi.fn().mockResolvedValue({
          jsonrpc: "2.0",
          id: "1",
          result: "0x3e8", // 1000
        }),
        batchRequest: vi.fn(),
        getRequestId: () => (Math.random() * 10000).toFixed(0),
      } as unknown as ELRpcProvider,
    };

    const response = await eth_blockNumber({
      ...options,
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "eth_blockNumber",
        params: [] as [],
      },
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: VERIFICATION_FAILED_RESPONSE_CODE,
        message: getVerificationFailedMessage("eth_blockNumber"),
      },
    });
  });

  it("should return error when EL returns invalid response", async () => {
    const options = {
      logger: getEmptyLogger(),
      proofProvider: {
        getExecutionPayload: vi.fn().mockResolvedValue({blockNumber: 1000}),
      } as unknown as ProofProvider,
      rpc: {
        request: vi.fn().mockResolvedValue({
          jsonrpc: "2.0",
          id: "1",
          error: {code: -32000, message: "server error"},
        }),
        batchRequest: vi.fn(),
        getRequestId: () => (Math.random() * 10000).toFixed(0),
      } as unknown as ELRpcProvider,
    };

    const response = await eth_blockNumber({
      ...options,
      payload: {
        jsonrpc: "2.0",
        id: 3,
        method: "eth_blockNumber",
        params: [] as [],
      },
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: {
        code: VERIFICATION_FAILED_RESPONSE_CODE,
        message: getVerificationFailedMessage("eth_blockNumber"),
      },
    });
  });

  it("should return error when CL has no latest payload", async () => {
    const options = {
      logger: getEmptyLogger(),
      proofProvider: {
        getExecutionPayload: vi.fn().mockRejectedValue(new Error("No latest payload")),
      } as unknown as ProofProvider,
      rpc: {
        request: vi.fn().mockResolvedValue({
          jsonrpc: "2.0",
          id: "1",
          result: "0x12d687",
        }),
        batchRequest: vi.fn(),
        getRequestId: () => (Math.random() * 10000).toFixed(0),
      } as unknown as ELRpcProvider,
    };

    const response = await eth_blockNumber({
      ...options,
      payload: {
        jsonrpc: "2.0",
        id: 4,
        method: "eth_blockNumber",
        params: [] as [],
      },
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 4,
      error: {
        code: VERIFICATION_FAILED_RESPONSE_CODE,
        message: getVerificationFailedMessage("eth_blockNumber"),
      },
    });
  });
});
