import {ELVerifiedRequestHandler} from "../interfaces.js";
import {verifyAccount} from "../utils/verification.js";
import {generateRPCResponseForPayload, generateUnverifiedResponseForPayload} from "../utils/json_rpc.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const eth_getBalance: ELVerifiedRequestHandler<[address: string, block?: number | string], string> = async ({
  handler,
  payload,
  logger,
  proofProvider,
}) => {
  const {
    params: [address, block],
  } = payload;
  const result = await verifyAccount({proofProvider, logger, handler, address, block});

  if (result.valid) {
    return generateRPCResponseForPayload(payload, result.data.balance);
  }

  logger.error("Request could not be verified.");
  return generateUnverifiedResponseForPayload(payload, "eth_getBalance request can not be verified.");
};
