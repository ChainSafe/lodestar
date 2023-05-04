import {ELVerifiedRequestHandler} from "../interfaces.js";
import {fetchAndVerifyAccount, fetchAndVerifyCode} from "../utils/execution.js";
import {generateRPCResponseForPayload, generateUnverifiedResponseForPayload} from "../utils/json_rpc.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const eth_getCode: ELVerifiedRequestHandler<[address: string, block?: number | string], string> = async ({
  handler,
  payload,
  logger,
  proofProvider,
}) => {
  const {
    params: [address, block],
  } = payload;
  // TODO: When batch requests are supported merged these two requests into one
  const accountProof = await fetchAndVerifyAccount({
    proofProvider,
    logger,
    handler,
    address,
    block,
  });

  if (!accountProof.valid) {
    logger.error("Request could not be verified.");
    return generateUnverifiedResponseForPayload(payload, "account for eth_getCode request can not be verified.");
  }

  const codeProof = await fetchAndVerifyCode({
    proofProvider,
    logger,
    handler,
    address,
    block,
    codeHash: accountProof.data.codeHash,
  });

  if (codeProof.valid) {
    return generateRPCResponseForPayload(payload, codeProof.data);
  }

  logger.error("Request could not be verified.");
  return generateUnverifiedResponseForPayload(payload, "eth_getCode request can not be verified.");
};
