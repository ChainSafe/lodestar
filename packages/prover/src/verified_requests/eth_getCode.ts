import {ELVerifiedRequestHandler} from "../interfaces.js";
import {verifyAccount, verifyCode} from "../utils/verification.js";
import {
  getErrorResponseForRequestWithFailedVerification,
  getResponseForRequest,
  getVerificationFailedMessage,
} from "../utils/json_rpc.js";

export const eth_getCode: ELVerifiedRequestHandler<[address: string, block?: number | string], string> = async ({
  rpc,
  payload,
  logger,
  proofProvider,
}) => {
  const {
    params: [address, block],
  } = payload;
  // TODO: When batch requests are supported merged these two requests into one
  const accountProof = await verifyAccount({
    proofProvider,
    logger,
    rpc,
    address,
    block,
  });

  if (!accountProof.valid) {
    logger.error("Request could not be verified.", {method: payload.method, params: JSON.stringify(payload.params)});
    return getErrorResponseForRequestWithFailedVerification(
      payload,
      "account for eth_getCode request can not be verified."
    );
  }

  const codeProof = await verifyCode({
    proofProvider,
    logger,
    rpc,
    address,
    block,
    codeHash: accountProof.data.codeHash,
  });

  if (codeProof.valid) {
    return getResponseForRequest(payload, codeProof.data);
  }

  logger.error("Request could not be verified.", {method: payload.method, params: JSON.stringify(payload.params)});
  return getErrorResponseForRequestWithFailedVerification(payload, getVerificationFailedMessage("eth_getCode"));
};
