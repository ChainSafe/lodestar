import {ELVerifiedRequestHandler} from "../interfaces.js";
import {ELBlock} from "../types.js";
import {verifyBlock} from "../utils/verification.js";
import {
  getErrorResponseForRequestWithFailedVerification,
  getResponseForRequest,
  getVerificationFailedMessage,
} from "../utils/json_rpc.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const eth_getBlockByNumber: ELVerifiedRequestHandler<
  [block: string | number, hydrated: boolean],
  ELBlock
> = async ({rpc, payload, logger, proofProvider}) => {
  const result = await verifyBlock({payload, proofProvider, logger, rpc});

  if (result.valid) {
    return getResponseForRequest(payload, result.data);
  }

  logger.error("Request could not be verified.", {method: payload.method, params: JSON.stringify(payload.params)});
  return getErrorResponseForRequestWithFailedVerification(
    payload,
    getVerificationFailedMessage("eth_getBlockByNumber")
  );
};
