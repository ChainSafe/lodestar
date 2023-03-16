import {ELVerifiedRequestHandler} from "../interfaces.js";
import {bufferToHex} from "../utils/conversion.js";
import {getELProof, isValidAccount, isValidStorageKeys} from "../utils/execution.js";
import {generateRPCResponseForPayload, generateUnverifiedResponseForPayload} from "../utils/json_rpc.js";

export const ethGetBalance: ELVerifiedRequestHandler<[address: string, block?: number | string], string> = async ({
  handler,
  payload,
  rootProvider,
}) => {
  const {
    params: [address, block],
  } = payload;
  const executionPayload = rootProvider.getExecutionPayload(block ?? "latest");
  const proof = await getELProof(handler, [address, [], bufferToHex(executionPayload.blockHash)]);

  if (
    (await isValidAccount({
      address: address,
      stateRoot: executionPayload.stateRoot,
      proof,
    })) &&
    (await isValidStorageKeys({storageKeys: [], proof}))
  ) {
    return generateRPCResponseForPayload(payload, proof.balance);
  }

  return generateUnverifiedResponseForPayload(payload, "eth_getBalance request can not be verified.");
};
