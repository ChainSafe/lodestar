import {Logger} from "@lodestar/utils";
import {ELRequestHandler, ELVerifiedRequestHandler} from "../interfaces.js";
import {ProofProvider} from "../proof_provider/proof_provider.js";
import {ELRequestPayload, ELResponse} from "../types.js";
import {eth_getBalance} from "../verified_requests/eth_getBalance.js";
import {eth_getTransactionCount} from "../verified_requests/eth_getTransactionCount.js";

/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any */
export const supportedELRequests: Record<string, ELVerifiedRequestHandler<any, any>> = {
  eth_getBalance: eth_getBalance,
  eth_getTransactionCount: eth_getTransactionCount,
};
/* eslint-enable @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any*/

export async function processAndVerifyRequest({
  payload,
  handler,
  proofProvider,
  logger,
}: {
  payload: ELRequestPayload;
  handler: ELRequestHandler;
  proofProvider: ProofProvider;
  logger: Logger;
}): Promise<ELResponse | undefined> {
  await proofProvider.waitToBeReady();
  logger.debug("Processing request", {method: payload.method, params: JSON.stringify(payload.params)});
  const verifiedHandler = supportedELRequests[payload.method];

  if (verifiedHandler !== undefined) {
    logger.verbose("Verified request handler found", {method: payload.method});
    return verifiedHandler({payload, handler, proofProvider, logger});
  }

  logger.warn("Verified request handler not found. Falling back to proxy.", {method: payload.method});
  return handler(payload);
}
