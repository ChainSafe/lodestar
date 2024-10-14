import {ELVerifiedRequestHandler} from "../interfaces.js";
import {verifyAccount} from "../utils/verification.js";
import {
  getErrorResponseForRequestWithFailedVerification,
  getResponseForRequest,
  getVerificationFailedMessage,
} from "../utils/json_rpc.js";

export const eth_getBalance: ELVerifiedRequestHandler<[address: string, block?: number | string], string> = async ({
  rpc,
  payload,
  logger,
  proofProvider,
}) => {
  const {
    params: [address, block],
  } = payload;
  const result = await verifyAccount({proofProvider, logger, rpc, address, block});

  if (result.valid) {
    return getResponseForRequest(payload, result.data.balance);
  }

  logger.error("Request could not be verified.", {method: payload.method, params: JSON.stringify(payload.params)});
  return getErrorResponseForRequestWithFailedVerification(payload, getVerificationFailedMessage("eth_getBalance"));
};
