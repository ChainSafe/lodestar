import {ELVerifiedRequestHandler} from "../interfaces.js";
import {fetchAndVerifyAccount} from "../utils/execution.js";
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
  const proof = await fetchAndVerifyAccount({proofProvider, logger, handler, address, block});

  if (proof) {
    return generateRPCResponseForPayload(payload, proof.balance);
  }

  logger.error("Request could not be verified.");
  return generateUnverifiedResponseForPayload(payload, "eth_getBalance request can not be verified.");
};
