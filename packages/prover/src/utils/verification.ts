import {Logger} from "@lodestar/utils";
import {ELRequestHandlerAny} from "../interfaces.js";
import {ProofProvider} from "../proof_provider/proof_provider.js";
import {ELBlock, ELProof, ELRequestPayload, HexString} from "../types.js";
import {bufferToHex} from "./conversion.js";
import {getELBlock, getELCode, getELProof} from "./execution.js";
import {isValidAccount, isValidBlock, isValidCodeHash, isValidStorageKeys} from "./validation.js";

type VerificationResult<T> = {data: T; valid: true} | {valid: false; data?: undefined};

export async function verifyAccount({
  address,
  proofProvider,
  logger,
  handler,
  block,
}: {
  address: HexString;
  handler: ELRequestHandlerAny;
  proofProvider: ProofProvider;
  logger: Logger;
  block?: number | string;
}): Promise<VerificationResult<ELProof>> {
  const executionPayload = await proofProvider.getExecutionPayload(block ?? "latest");
  const proof = await getELProof(handler, [address, [], bufferToHex(executionPayload.blockHash)]);
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
}

export async function verifyCode({
  address,
  proofProvider,
  logger,
  handler,
  codeHash,
  block,
}: {
  address: HexString;
  handler: ELRequestHandlerAny;
  proofProvider: ProofProvider;
  logger: Logger;
  codeHash: HexString;
  block?: number | string;
}): Promise<VerificationResult<string>> {
  const executionPayload = await proofProvider.getExecutionPayload(block ?? "latest");
  const code = await getELCode(handler, [address, bufferToHex(executionPayload.blockHash)]);

  if (await isValidCodeHash({codeHash, codeResponse: code, logger})) {
    return {data: code, valid: true};
  }

  return {valid: false};
}

export async function verifyBlock({
  payload,
  proofProvider,
  logger,
  handler,
}: {
  payload: ELRequestPayload<[block: string | number, hydrated: boolean]>;
  handler: ELRequestHandlerAny;
  proofProvider: ProofProvider;
  logger: Logger;
}): Promise<VerificationResult<ELBlock>> {
  const executionPayload = await proofProvider.getExecutionPayload(payload.params[0]);
  const block = await getELBlock(handler, payload.params);

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
}
