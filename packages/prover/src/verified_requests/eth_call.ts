import {ELVerifiedRequestHandler} from "../interfaces.js";
import {ELApiHandlers, ELApiParams, ELApiReturn} from "../types.js";
import {createEVM, executeEVM, getEVMWithState} from "../utils/evm.js";
import {generateRPCResponseForPayload, generateUnverifiedResponseForPayload} from "../utils/json_rpc.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const eth_call: ELVerifiedRequestHandler<ELApiParams["call"], ELApiReturn["call"]> = async ({
  handler,
  payload,
  logger,
  proofProvider,
  network,
}) => {
  const {
    params: [tx, block],
  } = payload;
  // We assume that standard tx validation already been done by the caller (web3, ethers.js, etc.)
  const executionPayload = await proofProvider.getExecutionPayload(block ?? "latest");

  try {
    // TODO: Optimize the creation of the evm
    const evm = await createEVM({proofProvider, network});
    const evmWithState = await getEVMWithState({
      handler: handler as unknown as ELApiHandlers["eth_getProof"],
      executionPayload,
      tx,
      evm,
      logger,
    });
    const result = await executeEVM({
      evm: evmWithState,
      tx,
      handler: handler as unknown as ELApiHandlers["eth_getBlockByHash"],
      executionPayload,
    });

    return generateRPCResponseForPayload(payload, result);
  } catch (err) {
    logger.error(
      "Request could not be verified.",
      {method: payload.method, params: JSON.stringify(payload.params)},
      err as Error
    );
    return generateUnverifiedResponseForPayload(payload, "eth_call request can not be verified.");
  }
};
