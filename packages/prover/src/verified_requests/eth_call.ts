import {ELVerifiedRequestHandler} from "../interfaces.js";
import {ELApiParams, ELApiReturn} from "../types.js";
import {bufferToHex} from "../utils/conversion.js";
import {createVM, executeVMCall, getVMWithState} from "../utils/evm.js";
import {
  getResponseForRequest,
  getErrorResponseForRequestWithFailedVerification,
  getVerificationFailedMessage,
} from "../utils/json_rpc.js";

export const eth_call: ELVerifiedRequestHandler<ELApiParams["eth_call"], ELApiReturn["eth_call"]> = async ({
  rpc,
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
      rpc,
      executionPayload,
      tx,
      vm,
      logger,
    });
    const result = await executeVMCall({
      vm: vmWithState,
      tx,
      rpc,
      executionPayload,
      network: proofProvider.network,
    });

    return getResponseForRequest(payload, bufferToHex(result.returnValue));
  } catch (err) {
    logger.error(
      "Request could not be verified.",
      {method: payload.method, params: JSON.stringify(payload.params)},
      err as Error
    );
    return getErrorResponseForRequestWithFailedVerification(payload, getVerificationFailedMessage("eth_call"));
  }
};
