import {Common, CustomChain, Hardfork} from "@ethereumjs/common";
import {ELApiParams, ELApiReturn, ELTransaction} from "../types.js";
import {isValidResponse} from "./json_rpc.js";
import {isBlockNumber, isPresent} from "./validation.js";
import {ELRpc} from "./rpc.js";

export type Optional<T, K extends keyof T> = Omit<T, K> & {[P in keyof T]?: T[P] | undefined};

export async function getELCode(rpc: ELRpc, args: ELApiParams["eth_getCode"]): Promise<ELApiReturn["eth_getCode"]> {
  const codeResult = await rpc.request("eth_getCode", args, {raiseError: false});

  if (!isValidResponse(codeResult)) {
    throw new Error(`Can not find code for address=${args[0]}`);
  }

  return codeResult.result;
}

export async function getELProof(rpc: ELRpc, args: ELApiParams["eth_getProof"]): Promise<ELApiReturn["eth_getProof"]> {
  const proof = await rpc.request("eth_getProof", args, {raiseError: false});
  if (!isValidResponse(proof)) {
    throw new Error(`Can not find proof for address=${args[0]}`);
  }
  return proof.result;
}

export async function getELBlock(
  rpc: ELRpc,
  args: ELApiParams["eth_getBlockByNumber"]
): Promise<ELApiReturn["eth_getBlockByNumber"]> {
  const block = await rpc.request(isBlockNumber(args[0]) ? "eth_getBlockByNumber" : "eth_getBlockByHash", args, {
    raiseError: false,
  });

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
    case "holesky":
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
