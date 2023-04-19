import {Logger} from "@lodestar/utils";
import {NetworkName} from "@lodestar/config/networks";
import {ELRequestHandler, ELVerifiedRequestHandler} from "../interfaces.js";
import {ProofProvider} from "../proof_provider/proof_provider.js";
import {ELRequestPayload, ELResponse} from "../types.js";
import {eth_getBalance} from "../verified_requests/eth_getBalance.js";
import {eth_getTransactionCount} from "../verified_requests/eth_getTransactionCount.js";
import {eth_getBlockByHash} from "../verified_requests/eth_getBlockByHash.js";
import {eth_getBlockByNumber} from "../verified_requests/eth_getBlockByNumber.js";
import {eth_getCode} from "../verified_requests/eth_getCode.js";

/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any */
export const supportedELRequests: Record<string, ELVerifiedRequestHandler<any, any>> = {
  eth_getBalance: eth_getBalance,
  eth_getTransactionCount: eth_getTransactionCount,
  eth_getBlockByHash: eth_getBlockByHash,
  eth_getBlockByNumber: eth_getBlockByNumber,
  eth_getCode: eth_getCode,
};
/* eslint-enable @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any*/

export async function processAndVerifyRequest({
  payload,
  handler,
  proofProvider,
  logger,
  network,
}: {
  payload: ELRequestPayload;
  handler: ELRequestHandler;
  proofProvider: ProofProvider;
  logger: Logger;
  network: NetworkName;
}): Promise<ELResponse | undefined> {
  await proofProvider.waitToBeReady();
  logger.debug("Processing request", {method: payload.method, params: JSON.stringify(payload.params)});
  const verifiedHandler = supportedELRequests[payload.method];

  if (verifiedHandler !== undefined) {
    logger.verbose("Verified request handler found", {method: payload.method});
    return verifiedHandler({payload, handler, proofProvider, logger, network});
  }

  logger.warn("Verified request handler not found. Falling back to proxy.", {method: payload.method});
  return handler(payload);
}
