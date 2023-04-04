import {ELVerifiedRequestHandler} from "../interfaces.js";
import {bufferToHex} from "../utils/conversion.js";
import {getELProof, isValidAccount, isValidStorageKeys} from "../utils/execution.js";
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
  const executionPayload = await proofProvider.getExecutionPayload(block ?? "latest");
  const proof = await getELProof(handler, [address, [], bufferToHex(executionPayload.blockHash)]);

  if (
    (await isValidAccount({
      address: address,
      stateRoot: executionPayload.stateRoot,
      logger,
      proof,
    })) &&
    (await isValidStorageKeys({storageKeys: [], proof, logger}))
  ) {
    return generateRPCResponseForPayload(payload, proof.balance);
  }

  logger.error("Request could not be verified.");
  return generateUnverifiedResponseForPayload(payload, "eth_getBalance request can not be verified.");
};
