import {ELRequestHandler} from "../interfaces.js";
import {ELBlock, ELProof} from "../types.js";
import {isValidResponse} from "./json_rpc.js";
import {isBlockNumber} from "./validation.js";

export function getRequestId(): string {
  // TODO: Find better way to generate random id
  return (Math.random() * 10000).toFixed(0);
}

/* eslint-disable @typescript-eslint/naming-convention */
type ELApi = {
  eth_getCode: (params: [address: string, block: number | string]) => string;
  eth_getProof: (params: [address: string, storageKeys: string[], block: number | string]) => ELProof;
  eth_getBlockByNumber: (params: [block: string | number, hydrated: boolean]) => ELBlock | undefined;
  eth_getBlockByHash: (params: [block: string, hydrated: boolean]) => ELBlock | undefined;
};
type ELApiParams = {
  [K in keyof ELApi]: Parameters<ELApi[K]>[0];
};
type ELApiReturn = {
  [K in keyof ELApi]: ReturnType<ELApi[K]>;
};
/* eslint-enable @typescript-eslint/naming-convention */

export async function getELCode(
  handler: ELRequestHandler<ELApiParams["eth_getCode"], ELApiReturn["eth_getCode"]>,
  args: ELApiParams["eth_getCode"]
): Promise<ELApiReturn["eth_getCode"]> {
  const codeResult = await handler({
    jsonrpc: "2.0",
    method: "eth_getCode",
    params: args,
    id: getRequestId(),
  });

  if (!isValidResponse(codeResult)) {
    throw new Error(`Can not find code. address=${args[0]}`);
  }

  return codeResult.result;
}

export async function getELProof(
  handler: ELRequestHandler<ELApiParams["eth_getProof"], ELApiReturn["eth_getProof"]>,
  args: ELApiParams["eth_getProof"]
): Promise<ELApiReturn["eth_getProof"]> {
  const proof = await handler({
    jsonrpc: "2.0",
    method: "eth_getProof",
    params: args,
    id: getRequestId(),
  });

  if (!isValidResponse(proof)) {
    throw new Error(`Can not find proof. address=${args[0]}`);
  }
  return proof.result;
}

export async function getELBlock(
  handler: ELRequestHandler<ELApiParams["eth_getBlockByNumber"], ELApiReturn["eth_getBlockByNumber"]>,
  args: ELApiParams["eth_getBlockByNumber"]
): Promise<ELApiReturn["eth_getBlockByNumber"]> {
  const block = await handler({
    jsonrpc: "2.0",
    method: isBlockNumber(args[0]) ? "eth_getBlockByNumber" : "eth_getBlockByHash",
    params: args,
    id: getRequestId(),
  });

  if (!isValidResponse(block)) {
    throw new Error(`Can not find block. id=${args[0]}`);
  }

  return block.result;
}
