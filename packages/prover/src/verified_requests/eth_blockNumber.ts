import {ELVerifiedRequestHandler} from "../interfaces.js";
import {numberToHex} from "../utils/conversion.js";
import {
  getErrorResponseForRequestWithFailedVerification,
  getResponseForRequest,
  getVerificationFailedMessage,
  isValidResponse,
} from "../utils/json_rpc.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const eth_blockNumber: ELVerifiedRequestHandler<[], string> = async ({payload, rpc, logger, proofProvider}) => {
  try {
    const elResponse = await rpc.request("eth_blockNumber", [], {raiseError: false});

    if (!isValidResponse(elResponse)) {
      throw new Error("Invalid response from EL for eth_blockNumber");
    }

    const elBlockNumber = parseInt(elResponse.result, 16);
    const executionPayload = await proofProvider.getExecutionPayload("latest");
    const clBlockNumber = executionPayload.blockNumber;

    if (elBlockNumber < clBlockNumber) {
      throw new Error(
        `EL block number (${elBlockNumber}) is behind CL block number (${clBlockNumber})`
      );
    }

    return getResponseForRequest(payload, numberToHex(elBlockNumber));
  } catch (err) {
    logger.error("Request could not be verified.", {method: payload.method}, err as Error);
    return getErrorResponseForRequestWithFailedVerification(
      payload,
      getVerificationFailedMessage("eth_blockNumber")
    );
  }
};
