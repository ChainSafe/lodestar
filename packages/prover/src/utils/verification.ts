import {Logger} from "@lodestar/utils";
import {ProofProvider} from "../proof_provider/proof_provider.js";
import {ELBlock, ELProof, HexString, JsonRpcRequest} from "../types.js";
import {bufferToHex} from "./conversion.js";
import {getELBlock, getELCode, getELProof} from "./execution.js";
import {isValidAccount, isValidBlock, isValidCodeHash, isValidStorageKeys} from "./validation.js";
import {ELRpc} from "./rpc.js";

type VerificationResult<T> = {data: T; valid: true} | {valid: false; data?: undefined};

export async function verifyAccount({
  address,
  proofProvider,
  logger,
  rpc,
  block,
}: {
  address: HexString;
  rpc: ELRpc;
  proofProvider: ProofProvider;
  logger: Logger;
  block?: number | string;
}): Promise<VerificationResult<ELProof>> {
  try {
    const executionPayload = await proofProvider.getExecutionPayload(block ?? "latest");
    const proof = await getELProof(rpc, [address, [], bufferToHex(executionPayload.blockHash)]);
    const validAccount = await isValidAccount({
      address: address,
      stateRoot: executionPayload.stateRoot,
      proof,
      logger,
    });

    // If account is invalid don't check the storage
    const validStorage = validAccount && (await isValidStorageKeys({storageKeys: [], proof, logger}));

    if (validAccount && validStorage) {
      return {data: proof, valid: true};
    }

    return {valid: false};
  } catch (err) {
    logger.error("Error while verifying account", {address}, err as Error);
    return {valid: false};
  }
}

export async function verifyCode({
  address,
  proofProvider,
  logger,
  rpc,
  codeHash,
  block,
}: {
  address: HexString;
  rpc: ELRpc;
  proofProvider: ProofProvider;
  logger: Logger;
  codeHash: HexString;
  block?: number | string;
}): Promise<VerificationResult<string>> {
  try {
    const executionPayload = await proofProvider.getExecutionPayload(block ?? "latest");
    const code = await getELCode(rpc, [address, bufferToHex(executionPayload.blockHash)]);

    if (await isValidCodeHash({codeHash, codeResponse: code, logger})) {
      return {data: code, valid: true};
    }
    return {valid: false};
  } catch (err) {
    logger.error("Error while verifying code", {address}, err as Error);
    return {valid: false};
  }
}

export async function verifyBlock({
  payload,
  proofProvider,
  logger,
  rpc,
}: {
  payload: JsonRpcRequest<[block: string | number, hydrated: boolean]>;
  rpc: ELRpc;
  proofProvider: ProofProvider;
  logger: Logger;
}): Promise<VerificationResult<ELBlock>> {
  try {
    const executionPayload = await proofProvider.getExecutionPayload(payload.params[0]);
    const block = await getELBlock(rpc, payload.params);

    // If response is not valid from the EL we don't need to verify it
    if (!block) return {data: block, valid: false};

    if (
      await isValidBlock({
        logger,
        block,
        executionPayload,
        config: proofProvider.config,
      })
    ) {
      return {data: block, valid: true};
    }

    return {valid: false};
  } catch (err) {
    logger.error("Error while verifying block", {block: payload.params[0]}, err as Error);
    return {valid: false};
  }
}
