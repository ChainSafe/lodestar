import {Logger} from "@lodestar/logger";
import {ELVerifiedRequestHandler} from "../interfaces.js";
import {ProofProvider} from "../proof_provider/proof_provider.js";
import {JsonRpcRequestOrBatch, JsonRpcBatchRequest, JsonRpcResponseOrBatch, JsonRpcBatchResponse} from "../types.js";
import {eth_getBalance} from "../verified_requests/eth_getBalance.js";
import {eth_getTransactionCount} from "../verified_requests/eth_getTransactionCount.js";
import {eth_getBlockByHash} from "../verified_requests/eth_getBlockByHash.js";
import {eth_getBlockByNumber} from "../verified_requests/eth_getBlockByNumber.js";
import {eth_getCode} from "../verified_requests/eth_getCode.js";
import {eth_call} from "../verified_requests/eth_call.js";
import {eth_estimateGas} from "../verified_requests/eth_estimateGas.js";
import {ELRpc} from "./execution.js";
import {isBatchRequest, isRequest} from "./json_rpc.js";
import {isNullish} from "./validation.js";

/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any */
export const supportedELRequests: Record<string, ELVerifiedRequestHandler<any, any>> = {
  eth_getBalance: eth_getBalance,
  eth_getTransactionCount: eth_getTransactionCount,
  eth_getBlockByHash: eth_getBlockByHash,
  eth_getBlockByNumber: eth_getBlockByNumber,
  eth_getCode: eth_getCode,
  eth_call: eth_call,
  eth_estimateGas: eth_estimateGas,
};

export function splitRequestsInChunks(payload: JsonRpcRequestOrBatch): {
  verifiable: JsonRpcBatchRequest;
  nonVerifiable: JsonRpcBatchRequest;
} {
  const verifiable: JsonRpcBatchRequest = [];
  const nonVerifiable: JsonRpcBatchRequest = [];

  for (const pay of isBatchRequest(payload) ? payload : [payload]) {
    if (isRequest(pay) && !isNullish(supportedELRequests[pay.method])) {
      verifiable.push(pay);
    } else {
      nonVerifiable.push(pay);
    }
  }

  return {verifiable, nonVerifiable};
}

export async function processAndVerifyRequest({
  payload,
  rpc,
  proofProvider,
  logger,
}: {
  payload: JsonRpcRequestOrBatch;
  rpc: ELRpc;
  proofProvider: ProofProvider;
  logger: Logger;
}): Promise<JsonRpcResponseOrBatch | undefined> {
  await proofProvider.waitToBeReady();
  const {verifiable, nonVerifiable} = splitRequestsInChunks(payload);
  const verifiedResponses: JsonRpcBatchResponse = [];
  const nonVerifiedResponses: JsonRpcBatchResponse = [];

  for (const request of verifiable) {
    logger.debug("Processing verifiable request", {
      method: request.method,
      params: JSON.stringify(request.params),
    });
    const verifiableRequestHandler = supportedELRequests[request.method];
    const response = await verifiableRequestHandler({payload: request, rpc, proofProvider, logger});
    verifiedResponses.push(response);
  }

  if (nonVerifiable.length > 0) {
    logger.warn("Forwarding non-verifiable requests to EL provider.", {count: nonVerifiable.length});
    const response = await rpc.batchRequest(nonVerifiable);
    nonVerifiedResponses.push(...response);
  }

  const responses = [...verifiedResponses, ...nonVerifiedResponses];

  if (responses.length === 1) {
    return responses[0];
  } else {
    return responses;
  }
}
