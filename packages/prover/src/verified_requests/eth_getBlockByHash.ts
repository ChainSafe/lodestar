import {ELVerifiedRequestHandler} from "../interfaces.js";
import {ELBlock} from "../types.js";
import {isValidBlock} from "../utils/execution.js";
import {generateUnverifiedResponseForPayload, isValidResponse} from "../utils/json_rpc.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const eth_getBlockByHash: ELVerifiedRequestHandler<[block: string, hydrated: boolean], ELBlock> = async ({
  handler,
  payload,
  logger,
  proofProvider,
}) => {
  const executionPayload = await proofProvider.getExecutionPayload(payload.params[0]);
  const elResponse = await handler(payload);

  // If response is not valid from the EL we don't need to verify it
  if (elResponse && !isValidResponse(elResponse)) return elResponse;

  if (
    elResponse &&
    elResponse.result &&
    (await isValidBlock({
      logger,
      block: elResponse.result,
      executionPayload,
    }))
  ) {
    return elResponse;
  }

  logger.error("Request could not be verified.");
  return generateUnverifiedResponseForPayload(payload, "eth_getBlockByHash request can not be verified.");
};
