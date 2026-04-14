import {ELVerifiedRequestHandler} from "../interfaces.js";
import {numberToHex} from "../utils/conversion.js";
import {
  getErrorResponseForRequestWithFailedVerification,
  getResponseForRequest,
  getVerificationFailedMessage,
  isValidResponse,
} from "../utils/json_rpc.js";

// Maximum blocks EL can be ahead of CL before we consider CL too stale to call "latest".
// EL is typically 0–2 blocks ahead of the CL light client view under normal operation.
const EL_CL_DRIFT_WINDOW = 2;

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

    // EL must not be behind the CL's trusted view
    if (elBlockNumber < clBlockNumber) {
      throw new Error(`EL (${elBlockNumber}) is behind CL (${clBlockNumber})`);
    }

    // EL must be within the drift window; beyond that, CL is too stale to verify "latest"
    if (elBlockNumber - clBlockNumber > EL_CL_DRIFT_WINDOW) {
      throw new Error(
        `CL too stale: EL (${elBlockNumber}) is more than ${EL_CL_DRIFT_WINDOW} blocks ahead of CL (${clBlockNumber})`
      );
    }

    // Return the CL-verified block number, not EL's — only the CL view is actually verified
    return getResponseForRequest(payload, numberToHex(clBlockNumber));
  } catch (err) {
    logger.error("Request could not be verified.", {method: payload.method}, err as Error);
    return getErrorResponseForRequestWithFailedVerification(payload, getVerificationFailedMessage("eth_blockNumber"));
  }
};
