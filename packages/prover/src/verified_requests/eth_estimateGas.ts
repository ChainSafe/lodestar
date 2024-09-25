import {ELVerifiedRequestHandler} from "../interfaces.js";
import {ELApiParams, ELApiReturn} from "../types.js";
import {bigIntToHex} from "../utils/conversion.js";
import {createVM, executeVMTx, getVMWithState} from "../utils/evm.js";
import {
  getErrorResponseForRequestWithFailedVerification,
  getResponseForRequest,
  getVerificationFailedMessage,
} from "../utils/json_rpc.js";

export const eth_estimateGas: ELVerifiedRequestHandler<
  ELApiParams["eth_estimateGas"],
  ELApiReturn["eth_estimateGas"]
> = async ({rpc, payload, logger, proofProvider}) => {
  const {
    params: [tx, block],
  } = payload;
  // We assume that standard tx validation already been done by the caller (web3, ethers.js, etc.)
  const executionPayload = await proofProvider.getExecutionPayload(block ?? "latest");

  try {
    // TODO: Optimize the creation of the evm
    const vm = await createVM({proofProvider});
    const vmWithState = await getVMWithState({
      rpc,
      executionPayload,
      tx,
      vm,
      logger,
    });

    const result = await executeVMTx({
      vm: vmWithState,
      tx,
      rpc,
      executionPayload,
      network: proofProvider.network,
    });

    return getResponseForRequest(payload, bigIntToHex(result.totalGasSpent));
  } catch (err) {
    logger.error(
      "Request could not be verified.",
      {method: payload.method, params: JSON.stringify(payload.params)},
      err as Error
    );
    return getErrorResponseForRequestWithFailedVerification(payload, getVerificationFailedMessage("eth_estimateGas"));
  }
};
