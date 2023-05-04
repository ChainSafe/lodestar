import { Blockchain } from "@ethereumjs/blockchain";
import { Account, Address } from "@ethereumjs/util";
import { VM } from "@ethereumjs/vm";
import { NetworkName } from "@lodestar/config/networks";
import { allForks } from "@lodestar/types";
import { Logger } from "@lodestar/utils";
import { ZERO_ADDRESS } from "../constants.js";
import { ProofProvider } from "../proof_provider/proof_provider.js";
import { ELApiHandlers, ELBlock, ELProof, ELTransaction, HexString } from "../types.js";
import {
  bufferToHex,
  hexToBigInt,
  hexToBuffer,
  numberToHex,
  padLeft
} from "./conversion.js";
import { elRpc, getChainCommon } from "./execution.js";
import { isValidResponse } from "./json_rpc.js";
import { isValidAccount, isValidCodeHash, isValidStorageKeys } from "./validation.js";

export async function createEVM({proofProvider, network}:{proofProvider: ProofProvider, network: NetworkName}): Promise<VM> {
  const common = getChainCommon(network);
  const blockchain = await Blockchain.create({common});

  // Connect blockchain object with existing proof provider for block history
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  (blockchain as any).getBlock = async (blockId: number) => {
    const payload = await proofProvider.getExecutionPayload(blockId);
    return {
      hash: () => payload.blockHash,
    };
  };
  const vm = await VM.create({common, blockchain});

  return vm;
}

export async function getEVMWithState({
  handler,
  executionPayload,
  tx,
  evm,
  logger,
}: {
  handler: ELApiHandlers["eth_getProof"] | ELApiHandlers["eth_getCode"] | ELApiHandlers["eth_createAccessList"];
  evm: VM;
  executionPayload: allForks.ExecutionPayload;
  tx: ELTransaction;
  logger: Logger;
}): Promise<VM> {
  const {stateRoot, blockHash, gasLimit} = executionPayload;
  const blockHashHex = bufferToHex(blockHash);

  // Create Access List for the contract call
  const response = await elRpc(handler as ELApiHandlers["eth_createAccessList"], "eth_createAccessList", [
    {
      to: tx.to,
      from: tx.from ?? ZERO_ADDRESS,
      data: tx.data,
      value: tx.value,
      gas: tx.gas ? tx.gas : numberToHex(gasLimit),
    } as ELTransaction,
    blockHashHex,
  ]);

  if (!isValidResponse(response) || response.result.error) {
    throw new Error("Invalid response from RPC");
  }

  const storageKeysMap: Record<string, string[]> = {};
  for (const {address, storageKeys} of response.result.accessList) {
    storageKeysMap[address] = storageKeys;
  }

  if (!storageKeysMap[tx.from ?? ZERO_ADDRESS]) {
    storageKeysMap[tx.from ?? ZERO_ADDRESS] = [];
  }

  if (tx.to && !storageKeysMap[tx.to]) {
    storageKeysMap[tx.to] = [];
  }

  // TODO: When we support batch requests, process with a single request
  const proofsAndCodes: Record<string, {proof: ELProof; code: string}> = {};
  for (const [address, storageKeys] of Object.entries(storageKeysMap)) {
    const {result: proof} = await elRpc(
      handler as ELApiHandlers["eth_getProof"],
      "eth_getProof",
      [address, storageKeys, blockHashHex],
      true
    );
    const validAccount = await isValidAccount({address, proof, logger, stateRoot});
    const validStorage = validAccount && (await isValidStorageKeys({storageKeys, proof, logger}));
    if (!validAccount || !validStorage) {
      throw new Error(`Invalid account: ${address}`);
    }

    const {result: codeResponse} = await elRpc(
      handler as ELApiHandlers["eth_getCode"],
      "eth_getCode",
      [address, blockHashHex],
      true
    );

    if (!isValidCodeHash({codeResponse, logger, codeHash: proof.codeHash})) {
      throw new Error(`Invalid code hash: ${address}`);
    }

    proofsAndCodes[address] = {proof, code: codeResponse};
  }

  await evm.stateManager.checkpoint();
  for (const [addressHex, {proof, code}] of Object.entries(proofsAndCodes)) {
    const address = Address.fromString(addressHex);

    const account = Account.fromAccountData({
      nonce: BigInt(proof.nonce),
      balance: BigInt(proof.balance),
      codeHash: proof.codeHash,
    });

    await evm.stateManager.putAccount(address, account);

    for (const storageAccess of proof.storageProof) {
      await evm.stateManager.putContractStorage(
        address,
        padLeft(hexToBuffer(storageAccess.key), 32),
        padLeft(hexToBuffer(storageAccess.value), 32)
      );
    }

    if (code !== "0x") await evm.stateManager.putContractCode(address, hexToBuffer(code));
  }

  await evm.stateManager.commit();
  return evm;
}

export async function executeEVM({
  handler,
  tx,
  evm,
  executionPayload,
}: {
  handler: ELApiHandlers["eth_getBlockByHash"];
  tx: ELTransaction;
  evm: VM;
  executionPayload: allForks.ExecutionPayload;
}): Promise<HexString> {
  const {from, to, gas, gasPrice, maxPriorityFeePerGas, value, data} = tx;
  const block = await elRpc(handler, "eth_getBlockByHash", [bufferToHex(executionPayload.blockHash), false], true);

  if (!block.result) {
    throw new Error(`Block not found: ${bufferToHex(executionPayload.blockHash)}`);
  }

  const {execResult} = await evm.evm.runCall({
    caller: from ? Address.fromString(from) : undefined,
    to: to ? Address.fromString(to) : undefined,
    gasLimit: hexToBigInt(gas),
    gasPrice: hexToBigInt(gasPrice ?? maxPriorityFeePerGas ?? "0x0"),
    value: hexToBigInt(value),
    data: data ? hexToBuffer(data) : undefined,
    block: {
      header: evmBlockHeaderFromELBlock(block.result),
    },
  });

  return bufferToHex(execResult.returnValue);
}

export function evmBlockHeaderFromELBlock(block: ELBlock): {
  number: bigint;
  cliqueSigner(): Address;
  coinbase: Address;
  timestamp: bigint;
  difficulty: bigint;
  prevRandao: Buffer;
  gasLimit: bigint;
  baseFeePerGas?: bigint;
} {
  return {
    number: hexToBigInt(block.number),
    cliqueSigner: () => Address.fromString(block.miner),
    timestamp: hexToBigInt(block.timestamp),
    difficulty: hexToBigInt(block.difficulty),
    gasLimit: hexToBigInt(block.gasLimit),
    baseFeePerGas: block.baseFeePerGas ? hexToBigInt(block.baseFeePerGas) : undefined,
    // TODO: Fix the coinbase address
    coinbase: Address.fromString(block.miner),
    // TODO: Fix the prevRandao value
    prevRandao: hexToBuffer(block.parentHash),
  };
}
