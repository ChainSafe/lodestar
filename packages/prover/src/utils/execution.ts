import {Logger} from "@lodestar/utils";
import {NetworkName} from "@lodestar/config/networks";
import {ELRequestHandler} from "../interfaces.js";
import {ProofProvider} from "../proof_provider/proof_provider.js";
import {ELBlock, ELProof, ELRequestPayload, ELResponse, HexString} from "../types.js";
import {bufferToHex} from "./conversion.js";
import {isValidResponse} from "./json_rpc.js";
import {isValidAccount, isValidBlock, isValidCodeHash, isValidStorageKeys} from "./verification.js";

export async function getELCode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: ELRequestHandler<[address: string, block: number | string], string>,
  args: [address: string, block: number | string]
): Promise<string> {
  // TODO: Find better way to generate random id
  const codeResult = await handler({
    jsonrpc: "2.0",
    method: "eth_getCode",
    params: args,
    id: (Math.random() * 10000).toFixed(0),
  });

  if (!codeResult || !codeResult.result) {
    throw new Error("Can not find code for given address.");
  }

  return codeResult.result;
}

export async function getELProof(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: ELRequestHandler<any, any>,
  args: [address: string, storageKeys: string[], block: number | string]
): Promise<ELProof> {
  // TODO: Find better way to generate random id
  const proof = await handler({
    jsonrpc: "2.0",
    method: "eth_getProof",
    params: args,
    id: (Math.random() * 10000).toFixed(0),
  });
  if (!proof) {
    throw new Error("Can not find proof for given address.");
  }
  return proof.result as ELProof;
}

export async function fetchAndVerifyAccount({
  address,
  proofProvider,
  logger,
  handler,
  block,
}: {
  address: HexString;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: ELRequestHandler<any, any>;
  proofProvider: ProofProvider;
  logger: Logger;
  block?: number | string;
}): Promise<{data: ELProof; valid: true} | {valid: false; data?: undefined}> {
  const executionPayload = await proofProvider.getExecutionPayload(block ?? "latest");
  const proof = await getELProof(handler, [address, [], bufferToHex(executionPayload.blockHash)]);

  if (
    (await isValidAccount({
      address: address,
      stateRoot: executionPayload.stateRoot,
      proof,
      logger,
    })) &&
    (await isValidStorageKeys({storageKeys: [], proof, logger}))
  ) {
    return {data: proof, valid: true};
  }

  return {valid: false};
}

export async function fetchAndVerifyCode({
  address,
  proofProvider,
  logger,
  handler,
  codeHash,
  block,
}: {
  address: HexString;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: ELRequestHandler<any, any>;
  proofProvider: ProofProvider;
  logger: Logger;
  codeHash: HexString;
  block?: number | string;
}): Promise<{data: string; valid: true} | {valid: false; data?: undefined}> {
  const executionPayload = await proofProvider.getExecutionPayload(block ?? "latest");
  const code = await getELCode(handler, [address, bufferToHex(executionPayload.blockHash)]);

  if (await isValidCodeHash({codeHash, codeResponse: code, logger})) {
    return {data: code, valid: true};
  }

  return {valid: false};
}

export async function fetchAndVerifyBlock({
  payload,
  proofProvider,
  logger,
  handler,
  network,
}: {
  payload: ELRequestPayload<[block: string | number, hydrated: boolean]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: ELRequestHandler<any, any>;
  proofProvider: ProofProvider;
  logger: Logger;
  network: NetworkName;
}): Promise<{data: ELResponse<ELBlock>; valid: true} | {valid: false; data?: undefined}> {
  const executionPayload = await proofProvider.getExecutionPayload(payload.params[0]);
  const elResponse = await (handler as ELRequestHandler<[block: string | number, hydrated: boolean], ELBlock>)(payload);

  // If response is not valid from the EL we don't need to verify it
  if (elResponse && !isValidResponse(elResponse)) return {data: elResponse, valid: true};

  if (
    elResponse &&
    elResponse.result &&
    (await isValidBlock({
      logger,
      block: elResponse.result,
      executionPayload,
      network,
    }))
  ) {
    return {data: elResponse, valid: true};
  }

  return {valid: false};
}
