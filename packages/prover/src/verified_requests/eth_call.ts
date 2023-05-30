import {ELVerifiedRequestHandler} from "../interfaces.js";
import {ELApiHandlers, ELApiParams, ELApiReturn} from "../types.js";
import {bufferToHex} from "../utils/conversion.js";
import {createVM, executeVMCall, getVMWithState} from "../utils/evm.js";
import {generateRPCResponseForPayload, generateUnverifiedResponseForPayload} from "../utils/json_rpc.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const eth_call: ELVerifiedRequestHandler<ELApiParams["eth_call"], ELApiReturn["eth_call"]> = async ({
  handler,
  payload,
  logger,
  proofProvider,
}) => {
  const {
    params: [tx, block],
  } = payload;
  // We assume that standard tx validation already been done by the caller (web3, ethers.js, etc.)
  const executionPayload = await proofProvider.getExecutionPayload(block ?? "latest");

  try {
    // TODO: Optimize the creation of the evm
    const vm = await createVM({proofProvider});
    const vmWithState = await getVMWithState({
      handler: handler as unknown as ELApiHandlers["eth_getProof"],
      executionPayload,
      tx,
      vm,
      logger,
    });
    const result = await executeVMCall({
      vm: vmWithState,
      tx,
      handler: handler as unknown as ELApiHandlers["eth_getBlockByHash"],
      executionPayload,
      network: proofProvider.network,
    });

    return generateRPCResponseForPayload(payload, bufferToHex(result.returnValue));
  } catch (err) {
    logger.error(
      "Request could not be verified.",
      {method: payload.method, params: JSON.stringify(payload.params)},
      err as Error
    );
    return generateUnverifiedResponseForPayload(payload, "eth_call request can not be verified.");
  }
};
