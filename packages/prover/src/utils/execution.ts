import {Common, CustomChain, Hardfork} from "@ethereumjs/common";
import {ELRequestHandler} from "../interfaces.js";
import {ELApiHandlers, ELApiParams, ELApiReturn, ELResponse, ELResponseWithResult, ELTransaction} from "../types.js";
import {isValidResponse} from "./json_rpc.js";
import {isBlockNumber, isPresent} from "./validation.js";

export function getRequestId(): string {
  // TODO: Find better way to generate random id
  return (Math.random() * 10000).toFixed(0);
}

export async function elRpc<
  P,
  R,
  E extends boolean = false,
  Return = E extends true ? ELResponseWithResult<R> : ELResponse<R> | undefined
>(handler: ELRequestHandler<P, R>, method: string, args: P, raiseError?: E): Promise<Return> {
  const response = await handler({
    jsonrpc: "2.0",
    method,
    params: args,
    id: getRequestId(),
  });

  if (raiseError && !isValidResponse(response)) {
    throw new Error(`Invalid response from RPC. method=${method} args=${JSON.stringify(args)}`);
  }

  return response as Return;
}

export async function getELCode(
  handler: ELApiHandlers["eth_getCode"],
  args: ELApiParams["eth_getCode"]
): Promise<ELApiReturn["eth_getCode"]> {
  const codeResult = await elRpc(handler, "eth_getCode", args);

  if (!isValidResponse(codeResult)) {
    throw new Error(`Can not find code. address=${args[0]}`);
  }

  return codeResult.result;
}

export async function getELProof(
  handler: ELApiHandlers["eth_getProof"],
  args: ELApiParams["eth_getProof"]
): Promise<ELApiReturn["eth_getProof"]> {
  const proof = await elRpc(handler, "eth_getProof", args);

  if (!isValidResponse(proof)) {
    throw new Error(`Can not find proof for address=${args[0]}`);
  }
  return proof.result;
}

export async function getELBlock(
  handler: ELApiHandlers["eth_getBlockByNumber"],
  args: ELApiParams["eth_getBlockByNumber"]
): Promise<ELApiReturn["eth_getBlockByNumber"]> {
  const block = await elRpc(handler, isBlockNumber(args[0]) ? "eth_getBlockByNumber" : "eth_getBlockByHash", args);

  if (!isValidResponse(block)) {
    throw new Error(`Can not find block. id=${args[0]}`);
  }

  return block.result;
}

export function getChainCommon(network: string): Common {
  switch (network) {
    case "mainnet":
    case "goerli":
    case "ropsten":
    case "sepolia":
      // TODO: Not sure how to detect the fork during runtime
      return new Common({chain: network, hardfork: Hardfork.Shanghai});
    case "minimal":
      // TODO: Not sure how to detect the fork during runtime
      return new Common({chain: "mainnet", hardfork: Hardfork.Shanghai});
    case "gnosis":
      return new Common({chain: CustomChain.xDaiChain});
    default:
      throw new Error(`Non supported network "${network}"`);
  }
}

export function getTxType(tx: ELTransaction): number {
  if (isPresent(tx.maxFeePerGas) || isPresent(tx.maxPriorityFeePerGas)) {
    return 2;
  }

  if (isPresent(tx.accessList)) {
    return 1;
  }

  return 0;
}
