import {ELVerifiedRequestHandler} from "../interfaces.js";
import {ELApiHandlers, ELApiParams, ELApiReturn} from "../types.js";
import {bigIntToHex} from "../utils/conversion.js";
import {createVM, executeVMTx, getVMWithState} from "../utils/evm.js";
import {generateRPCResponseForPayload, generateUnverifiedResponseForPayload} from "../utils/json_rpc.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const eth_estimateGas: ELVerifiedRequestHandler<
  ELApiParams["eth_estimateGas"],
  ELApiReturn["eth_estimateGas"]
> = async ({handler, payload, logger, proofProvider, network}) => {
  const {
    params: [tx, block],
  } = payload;
  // We assume that standard tx validation already been done by the caller (web3, ethers.js, etc.)
  const executionPayload = await proofProvider.getExecutionPayload(block ?? "latest");

  try {
    // TODO: Optimize the creation of the evm
    const evm = await createVM({proofProvider, network});
    const vmWithState = await getVMWithState({
      handler: handler as unknown as ELApiHandlers["eth_getProof"],
      executionPayload,
      tx,
      vm: evm,
      logger,
    });

    const result = await executeVMTx({
      vm: vmWithState,
      tx,
      handler: handler as unknown as ELApiHandlers["eth_getBlockByHash"],
      executionPayload,
      network,
    });

    return generateRPCResponseForPayload(payload, bigIntToHex(result.totalGasSpent));
  } catch (err) {
    logger.error(
      "Request could not be verified.",
      {method: payload.method, params: JSON.stringify(payload.params)},
      err as Error
    );
    return generateUnverifiedResponseForPayload(payload, "eth_estimateGas request can not be verified.");
  }
};
