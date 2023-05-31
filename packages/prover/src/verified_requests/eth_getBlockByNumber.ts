import {ELVerifiedRequestHandler} from "../interfaces.js";
import {ELBlock} from "../types.js";
import {verifyBlock} from "../utils/verification.js";
import {generateUnverifiedResponseForPayload, generateVerifiedResponseForPayload} from "../utils/json_rpc.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const eth_getBlockByNumber: ELVerifiedRequestHandler<
  [block: string | number, hydrated: boolean],
  ELBlock
> = async ({handler, payload, logger, proofProvider}) => {
  const result = await verifyBlock({payload, proofProvider, logger, handler});

  if (result.valid) {
    return generateVerifiedResponseForPayload(payload, result.data);
  }

  logger.error("Request could not be verified.", {method: payload.method, params: JSON.stringify(payload.params)});
  return generateUnverifiedResponseForPayload(payload, "eth_getBlockByNumber request can not be verified.");
};
