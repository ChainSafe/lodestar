import {ELVerifiedRequestHandler} from "../interfaces.js";
import {numberToHex} from "../utils/conversion.js";
import {
  getErrorResponseForRequestWithFailedVerification,
  getResponseForRequest,
  getVerificationFailedMessage,
} from "../utils/json_rpc.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const eth_getBlockNumber: ELVerifiedRequestHandler<[], string> = async ({payload, logger, proofProvider}) => {
  try {
    const executionPayload = await proofProvider.getExecutionPayload("latest");
    const blockNumber = numberToHex(executionPayload.blockNumber);

    return getResponseForRequest(payload, blockNumber);
  } catch (err) {
    logger.error("Request could not be verified.", {method: payload.method}, err as Error);
    return getErrorResponseForRequestWithFailedVerification(
      payload,
      getVerificationFailedMessage("eth_getBlockNumber")
    );
  }
};
