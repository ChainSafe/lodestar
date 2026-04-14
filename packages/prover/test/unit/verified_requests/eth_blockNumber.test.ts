import {describe, expect, it, vi} from "vitest";
import {getEmptyLogger} from "@lodestar/logger/empty";
import {VERIFICATION_FAILED_RESPONSE_CODE} from "../../../src/constants.js";
import {ProofProvider} from "../../../src/proof_provider/proof_provider.js";
import {getVerificationFailedMessage} from "../../../src/utils/json_rpc.js";
import {ELRpcProvider} from "../../../src/utils/rpc_provider.js";
import {eth_blockNumber} from "../../../src/verified_requests/eth_blockNumber.js";

describe("verified_requests / eth_blockNumber", () => {
  const buildOptions = ({
    elResult,
    clBlockNumber,
    rejectCl,
  }: {
    elResult: unknown;
    clBlockNumber?: number;
    rejectCl?: boolean;
  }) => ({
    logger: getEmptyLogger(),
    proofProvider: {
      getExecutionPayload: rejectCl
        ? vi.fn().mockRejectedValue(new Error("No latest payload"))
        : vi.fn().mockResolvedValue({blockNumber: clBlockNumber}),
    } as unknown as ProofProvider,
    rpc: {
      request: vi.fn().mockResolvedValue(elResult),
      batchRequest: vi.fn(),
      getRequestId: () => (Math.random() * 10000).toFixed(0),
    } as unknown as ELRpcProvider,
  });

  const payload = {jsonrpc: "2.0" as const, id: 1, method: "eth_blockNumber", params: [] as []};

  it("returns the CL-verified block number when EL is within drift window (EL ahead by 2)", async () => {
    // EL = 1002, CL = 1000; within drift window of 2
    const options = buildOptions({
      elResult: {jsonrpc: "2.0", id: "1", result: "0x3ea"}, // 1002
      clBlockNumber: 1000,
    });

    const response = await eth_blockNumber({...options, payload});

    // Returns CL's block number (0x3e8 = 1000), not EL's
    expect(response).toEqual({jsonrpc: "2.0", id: 1, result: "0x3e8"});
    expect(options.rpc.request).toHaveBeenCalledWith("eth_blockNumber", [], {raiseError: false});
    expect(options.proofProvider.getExecutionPayload).toHaveBeenCalledWith("latest");
  });

  it("returns the CL-verified block number when EL equals CL", async () => {
    const options = buildOptions({
      elResult: {jsonrpc: "2.0", id: "1", result: "0x3e8"}, // 1000
      clBlockNumber: 1000,
    });

    const response = await eth_blockNumber({...options, payload});

    expect(response).toEqual({jsonrpc: "2.0", id: 1, result: "0x3e8"});
  });

  it("returns error when EL is behind CL", async () => {
    const options = buildOptions({
      elResult: {jsonrpc: "2.0", id: "1", result: "0x3e8"}, // 1000
      clBlockNumber: 2000,
    });

    const response = await eth_blockNumber({...options, payload});

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: VERIFICATION_FAILED_RESPONSE_CODE,
        message: getVerificationFailedMessage("eth_blockNumber"),
      },
    });
  });

  it("returns error when EL is more than 2 blocks ahead of CL (CL too stale)", async () => {
    // EL = 1005, CL = 1000; drift of 5 exceeds window of 2
    const options = buildOptions({
      elResult: {jsonrpc: "2.0", id: "1", result: "0x3ed"}, // 1005
      clBlockNumber: 1000,
    });

    const response = await eth_blockNumber({...options, payload});

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: VERIFICATION_FAILED_RESPONSE_CODE,
        message: getVerificationFailedMessage("eth_blockNumber"),
      },
    });
  });

  it("returns error when EL returns an invalid response", async () => {
    const options = buildOptions({
      elResult: {jsonrpc: "2.0", id: "1", error: {code: -32000, message: "server error"}},
      clBlockNumber: 1000,
    });

    const response = await eth_blockNumber({...options, payload});

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: VERIFICATION_FAILED_RESPONSE_CODE,
        message: getVerificationFailedMessage("eth_blockNumber"),
      },
    });
  });

  it("returns error when CL has no latest payload", async () => {
    const options = buildOptions({
      elResult: {jsonrpc: "2.0", id: "1", result: "0x3e8"},
      rejectCl: true,
    });

    const response = await eth_blockNumber({...options, payload});

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: VERIFICATION_FAILED_RESPONSE_CODE,
        message: getVerificationFailedMessage("eth_blockNumber"),
      },
    });
  });
});
