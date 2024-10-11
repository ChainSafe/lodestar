import {Blockchain} from "@ethereumjs/blockchain";
import {Account, Address} from "@ethereumjs/util";
import {VM, RunTxResult} from "@ethereumjs/vm";
import {TransactionFactory} from "@ethereumjs/tx";
import {Block, BlockHeader} from "@ethereumjs/block";
import {NetworkName} from "@lodestar/config/networks";
import {Logger} from "@lodestar/utils";
import {ExecutionPayload} from "@lodestar/types";
import {ZERO_ADDRESS} from "../constants.js";
import {ProofProvider} from "../proof_provider/proof_provider.js";
import {ELBlock, ELProof, ELTransaction, JsonRpcVersion} from "../types.js";
import {bufferToHex, chunkIntoN, cleanObject, hexToBigInt, hexToBuffer, numberToHex, padLeft} from "./conversion.js";
import {getChainCommon, getTxType} from "./execution.js";
import {isValidResponse} from "./json_rpc.js";
import {isNullish, isValidAccount, isValidCodeHash, isValidStorageKeys} from "./validation.js";
import {ELRpcProvider} from "./rpc_provider.js";

export async function createVM({proofProvider}: {proofProvider: ProofProvider}): Promise<VM> {
  const common = getChainCommon(proofProvider.config.PRESET_BASE as string);
  const blockchain = await Blockchain.create({common});

  // Connect blockchain object with existing proof provider for block history
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  (blockchain as any).getBlock = async (blockId: number) => {
    const payload = await proofProvider.getExecutionPayload(blockId);
    return {
      hash: () => payload.blockHash,
    };
  };
  const vm = await VM.create({common, blockchain});

  return vm;
}

export async function getVMWithState({
  rpc,
  executionPayload,
  tx,
  vm,
  logger,
}: {
  rpc: ELRpcProvider;
  vm: VM;
  executionPayload: ExecutionPayload;
  tx: ELTransaction;
  logger: Logger;
}): Promise<VM> {
  const {stateRoot, blockHash, gasLimit} = executionPayload;
  const blockHashHex = bufferToHex(blockHash);

  // If tx does not have a from address then it must be initiated via zero address
  const from = tx.from ?? ZERO_ADDRESS;
  const to = tx.to;

  // Create Access List for the contract call
  const accessListTx = cleanObject({
    to,
    from,
    data: tx.input ? tx.input : tx.data,
    value: tx.value,
    gas: tx.gas ? tx.gas : numberToHex(gasLimit),
    gasPrice: "0x0",
  }) as ELTransaction;
  const response = await rpc.request("eth_createAccessList", [accessListTx, blockHashHex], {raiseError: false});

  if (!isValidResponse(response) || response.result.error) {
    throw new Error(`Invalid response from RPC. method: eth_createAccessList, params: ${JSON.stringify(tx)}`);
  }

  const storageKeysMap: Record<string, string[]> = {};
  for (const {address, storageKeys} of response.result.accessList) {
    storageKeysMap[address] = storageKeys;
  }

  // If from address is not present then we have to fetch it for all keys
  if (isNullish(storageKeysMap[from])) {
    storageKeysMap[from] = [];
  }

  // If to address is not present then we have to fetch it with for all keys
  if (to && isNullish(storageKeysMap[to])) {
    storageKeysMap[to] = [];
  }

  const batchRequests = [];
  for (const [address, storageKeys] of Object.entries(storageKeysMap)) {
    batchRequests.push({
      jsonrpc: "2.0" as JsonRpcVersion,
      id: rpc.getRequestId(),
      method: "eth_getProof",
      params: [address, storageKeys, blockHashHex],
    });

    batchRequests.push({
      jsonrpc: "2.0" as JsonRpcVersion,
      id: rpc.getRequestId(),
      method: "eth_getCode",
      params: [address, blockHashHex],
    });
  }

  // If all responses are valid then we will have even number of responses
  // For each address, one response for eth_getProof and one for eth_getCode
  const batchResponse = await rpc.batchRequest(batchRequests, {raiseError: true});
  const batchResponseInChunks = chunkIntoN(batchResponse, 2);

  const vmState: VMState = {};
  for (const [proofResponse, codeResponse] of batchResponseInChunks) {
    const addressHex = proofResponse.request.params[0] as string;
    if (!isNullish(vmState[addressHex])) continue;

    const proof = proofResponse.response.result as ELProof;
    const storageKeys = proofResponse.request.params[1] as string[];
    const code = codeResponse.response.result as string;

    const validAccount = await isValidAccount({address: addressHex, proof, logger, stateRoot});
    const validStorage = validAccount && (await isValidStorageKeys({storageKeys, proof, logger}));
    if (!validAccount || !validStorage) {
      throw new Error(`Invalid account: ${addressHex}`);
    }

    if (!(await isValidCodeHash({codeResponse: code, logger, codeHash: proof.codeHash}))) {
      throw new Error(`Invalid code hash: ${addressHex}`);
    }

    vmState[addressHex] = {code, proof};
  }

  return updateVMWithState({vm, state: vmState, logger});
}
type VMState = Record<string, {code: string; proof: ELProof}>;
export async function updateVMWithState({vm, state}: {logger: Logger; state: VMState; vm: VM}): Promise<VM> {
  await vm.stateManager.checkpoint();
  for (const [addressHex, {proof, code}] of Object.entries(state)) {
    const address = Address.fromString(addressHex);
    const codeBuffer = hexToBuffer(code);

    const account = Account.fromAccountData({
      nonce: BigInt(proof.nonce),
      balance: BigInt(proof.balance),
      codeHash: proof.codeHash,
    });

    await vm.stateManager.putAccount(address, account);

    for (const {key, value} of proof.storageProof) {
      await vm.stateManager.putContractStorage(address, padLeft(hexToBuffer(key), 32), padLeft(hexToBuffer(value), 32));
    }
    if (codeBuffer.byteLength !== 0) await vm.stateManager.putContractCode(address, codeBuffer);
  }

  await vm.stateManager.commit();
  return vm;
}

export async function executeVMCall({
  rpc,
  tx,
  vm,
  executionPayload,
  network,
}: {
  rpc: ELRpcProvider;
  tx: ELTransaction;
  vm: VM;
  executionPayload: ExecutionPayload;
  network: NetworkName;
}): Promise<RunTxResult["execResult"]> {
  const {from, to, gas, gasPrice, maxPriorityFeePerGas, value, data, input} = tx;
  const blockHash = bufferToHex(executionPayload.blockHash);
  const {result: block} = await rpc.request("eth_getBlockByHash", [blockHash, true], {
    raiseError: true,
  });

  if (!block) {
    throw new Error(`Block not found: ${blockHash}`);
  }

  const {execResult} = await vm.evm.runCall({
    caller: from ? Address.fromString(from) : undefined,
    to: to ? Address.fromString(to) : undefined,
    gasLimit: hexToBigInt(gas ?? block.gasLimit),
    gasPrice: hexToBigInt(gasPrice ?? maxPriorityFeePerGas ?? "0x0"),
    value: hexToBigInt(value ?? "0x0"),
    data: input ? hexToBuffer(input) : data ? hexToBuffer(data) : undefined,
    block: {
      header: getVMBlockHeaderFromELBlock(block, executionPayload, network),
    },
  });

  if (execResult.exceptionError) {
    throw new Error(execResult.exceptionError.error);
  }

  return execResult;
}

export async function executeVMTx({
  rpc,
  tx,
  vm,
  executionPayload,
  network,
}: {
  rpc: ELRpcProvider;
  tx: ELTransaction;
  vm: VM;
  executionPayload: ExecutionPayload;
  network: NetworkName;
}): Promise<RunTxResult> {
  const {result: block} = await rpc.request("eth_getBlockByHash", [bufferToHex(executionPayload.blockHash), true], {
    raiseError: true,
  });

  if (!block) {
    throw new Error(`Block not found: ${bufferToHex(executionPayload.blockHash)}`);
  }
  const txType = getTxType(tx);
  const from = tx.from ? Address.fromString(tx.from) : Address.zero();
  const to = tx.to ? Address.fromString(tx.to) : undefined;

  const txData = {
    ...tx,
    from,
    to,
    type: txType,
    // If no gas limit is specified use the last block gas limit as an upper bound.
    gasLimit: hexToBigInt(tx.gas ?? block.gasLimit),
  };

  if (txType === 2) {
    // Handle EIP-1559 transactions
    // To fix the vm error: Transaction's maxFeePerGas (0) is less than the block's baseFeePerGas
    txData.maxFeePerGas = txData.maxFeePerGas ?? block.baseFeePerGas;
  } else {
    // Legacy transaction
    txData.gasPrice = isNullish(txData.gasPrice) || txData.gasPrice === "0x0" ? block.baseFeePerGas : txData.gasPrice;
  }

  const txObject = TransactionFactory.fromTxData(txData, {common: getChainCommon(network), freeze: false});

  // Override to avoid tx signature verification
  txObject.getSenderAddress = () => (tx.from ? Address.fromString(tx.from) : Address.zero());

  const result = await vm.runTx({
    tx: txObject,
    skipNonce: true,
    skipBalance: true,
    skipBlockGasLimitValidation: true,
    skipHardForkValidation: true,
    block: {
      header: getVMBlockHeaderFromELBlock(block, executionPayload, network),
    } as Block,
  });

  return result;
}

export function getVMBlockHeaderFromELBlock(
  block: ELBlock,
  executionPayload: ExecutionPayload,
  network: NetworkName
): BlockHeader {
  const blockHeaderData = {
    number: hexToBigInt(block.number),
    cliqueSigner: () => Address.fromString(block.miner),
    timestamp: hexToBigInt(block.timestamp),
    difficulty: hexToBigInt(block.difficulty),
    gasLimit: hexToBigInt(block.gasLimit),
    baseFeePerGas: block.baseFeePerGas ? hexToBigInt(block.baseFeePerGas) : undefined,

    // Use these values from the execution payload
    // instead of the block values to ensure that
    // the VM is using the verified values from the lightclient
    prevRandao: Buffer.from(executionPayload.prevRandao),
    stateRoot: Buffer.from(executionPayload.stateRoot),
    parentHash: Buffer.from(executionPayload.parentHash),

    // TODO: Fix the coinbase address
    coinbase: Address.fromString(block.miner),
  };

  return BlockHeader.fromHeaderData(blockHeaderData, {common: getChainCommon(network)});
}
