import {ELVerifiedRequestHandler} from "../interfaces.js";
import {verifyAccount} from "../utils/verification.js";
import {getResponseForRequest, getErrorResponseForUnverifiedRequest} from "../utils/json_rpc.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const eth_getTransactionCount: ELVerifiedRequestHandler<
  [address: string, block?: number | string],
  string
> = async ({rpc, payload, logger, proofProvider}) => {
  const {
    params: [address, block],
  } = payload;
  const result = await verifyAccount({proofProvider, logger, rpc, address, block});

  if (result.valid) {
    return getResponseForRequest(payload, result.data.nonce);
  }

  logger.error("Request could not be verified.", {method: payload.method, params: JSON.stringify(payload.params)});
  return getErrorResponseForUnverifiedRequest(payload, "eth_getTransactionCount request can not be verified.");
};
