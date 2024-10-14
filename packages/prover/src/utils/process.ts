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
import {getResponseForRequest, isBatchRequest, isRequest} from "./json_rpc.js";
import {isNullish} from "./validation.js";
import {ELRpcProvider} from "./rpc_provider.js";

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export const verifiableMethodHandlers: Record<string, ELVerifiedRequestHandler<any, any>> = {
  eth_getBalance: eth_getBalance,
  eth_getTransactionCount: eth_getTransactionCount,
  eth_getBlockByHash: eth_getBlockByHash,
  eth_getBlockByNumber: eth_getBlockByNumber,
  eth_getCode: eth_getCode,
  eth_call: eth_call,
  eth_estimateGas: eth_estimateGas,
};

export const verifiableMethods = Object.keys(verifiableMethodHandlers);
export const alwaysAllowedMethods = ["eth_subscribe", "eth_unsubscribe", "eth_getProof"];

export function splitRequestsInChunks(
  payload: JsonRpcRequestOrBatch,
  unverifiedWhitelist?: string[]
): {
  verifiable: JsonRpcBatchRequest;
  nonVerifiable: JsonRpcBatchRequest;
  blocked: JsonRpcBatchRequest;
} {
  const verifiable: JsonRpcBatchRequest = [];
  const nonVerifiable: JsonRpcBatchRequest = [];
  const blocked: JsonRpcBatchRequest = [];

  for (const pay of isBatchRequest(payload) ? payload : [payload]) {
    if (isRequest(pay) && verifiableMethods.includes(pay.method)) {
      verifiable.push(pay);
      continue;
    }

    // If unverifiedWhitelist is not set that implies all methods are allowed
    if ((isRequest(pay) && isNullish(unverifiedWhitelist)) || unverifiedWhitelist?.includes(pay.method)) {
      nonVerifiable.push(pay);
      continue;
    }

    if (alwaysAllowedMethods.includes(pay.method)) {
      nonVerifiable.push(pay);
      continue;
    }

    blocked.push(pay);
  }

  return {verifiable, nonVerifiable, blocked};
}

export async function processAndVerifyRequest({
  payload,
  rpc,
  proofProvider,
  logger,
}: {
  payload: JsonRpcRequestOrBatch;
  rpc: ELRpcProvider;
  proofProvider: ProofProvider;
  logger: Logger;
}): Promise<JsonRpcResponseOrBatch | undefined> {
  await proofProvider.waitToBeReady();

  const {verifiable, nonVerifiable, blocked} = splitRequestsInChunks(payload, proofProvider.opts.unverifiedWhitelist);
  const verifiedResponses: JsonRpcBatchResponse = [];
  const nonVerifiedResponses: JsonRpcBatchResponse = [];
  const blockedResponses: JsonRpcBatchResponse = [];

  for (const request of verifiable) {
    logger.debug("Processing verifiable request", {
      method: request.method,
      params: JSON.stringify(request.params),
    });
    const verifiableRequestHandler = verifiableMethodHandlers[request.method];
    const response = await verifiableRequestHandler({payload: request, rpc, proofProvider, logger});
    verifiedResponses.push(response);
  }

  if (nonVerifiable.length > 0) {
    logger.warn("Forwarding non-verifiable requests to EL provider.", {count: nonVerifiable.length});
    const response = await rpc.batchRequest(nonVerifiable, {raiseError: false});
    nonVerifiedResponses.push(...response.map((r) => r.response));
  }

  for (const request of blocked) {
    blockedResponses.push(
      getResponseForRequest(request, undefined, {message: `Method "${request.method}" not allowed.`})
    );
  }

  const responses = [...verifiedResponses, ...nonVerifiedResponses, ...blockedResponses];

  if (responses.length === 1) {
    return responses[0];
  }
  return responses;
}
