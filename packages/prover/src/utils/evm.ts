import {Blockchain} from "@ethereumjs/blockchain";
import {Account, Address} from "@ethereumjs/util";
import {VM, RunTxResult} from "@ethereumjs/vm";
import {TransactionFactory} from "@ethereumjs/tx";
import {Block, BlockHeader} from "@ethereumjs/block";
import {NetworkName} from "@lodestar/config/networks";
import {allForks} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {ZERO_ADDRESS} from "../constants.js";
import {ProofProvider} from "../proof_provider/proof_provider.js";
import {ELApiHandlers, ELBlock, ELProof, ELTransaction} from "../types.js";
import {bufferToHex, cleanObject, hexToBigInt, hexToBuffer, numberToHex, padLeft} from "./conversion.js";
import {elRpc, getChainCommon, getTxType} from "./execution.js";
import {isValidResponse} from "./json_rpc.js";
import {isNullish, isValidAccount, isValidCodeHash, isValidStorageKeys} from "./validation.js";

export async function createVM({
  proofProvider,
  network,
}: {
  proofProvider: ProofProvider;
  network: NetworkName;
}): Promise<VM> {
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

export async function getVMWithState({
  handler,
  executionPayload,
  tx,
  vm,
  logger,
}: {
  handler: ELApiHandlers["eth_getProof"] | ELApiHandlers["eth_getCode"] | ELApiHandlers["eth_createAccessList"];
  vm: VM;
  executionPayload: allForks.ExecutionPayload;
  tx: ELTransaction;
  logger: Logger;
}): Promise<VM> {
  const {stateRoot, blockHash, gasLimit} = executionPayload;
  const blockHashHex = bufferToHex(blockHash);

  // Create Access List for the contract call
  const accessListTx = cleanObject({
    to: tx.to,
    from: tx.from ?? ZERO_ADDRESS,
    data: tx.data,
    value: tx.value,
    gas: tx.gas ? tx.gas : numberToHex(gasLimit),
    gasPrice: "0x0",
  }) as ELTransaction;
  const response = await elRpc(handler as ELApiHandlers["eth_createAccessList"], "eth_createAccessList", [
    accessListTx,
    blockHashHex,
  ]);

  if (!isValidResponse(response) || response.result.error) {
    throw new Error(`Invalid response from RPC. method: eth_createAccessList, params: ${JSON.stringify(tx)}`);
  }

  const storageKeysMap: Record<string, string[]> = {};
  for (const {address, storageKeys} of response.result.accessList) {
    storageKeysMap[address] = storageKeys;
  }

  if (storageKeysMap[tx.from ?? ZERO_ADDRESS] === undefined) {
    storageKeysMap[tx.from ?? ZERO_ADDRESS] = [];
  }

  if (tx.to && storageKeysMap[tx.to] === undefined) {
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

    if (!(await isValidCodeHash({codeResponse, logger, codeHash: proof.codeHash}))) {
      throw new Error(`Invalid code hash: ${address}`);
    }

    proofsAndCodes[address] = {proof, code: codeResponse};
  }

  await vm.stateManager.checkpoint();
  for (const [addressHex, {proof, code}] of Object.entries(proofsAndCodes)) {
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
  handler,
  tx,
  vm,
  executionPayload,
  network,
}: {
  handler: ELApiHandlers["eth_getBlockByHash"];
  tx: ELTransaction;
  vm: VM;
  executionPayload: allForks.ExecutionPayload;
  network: NetworkName;
}): Promise<RunTxResult["execResult"]> {
  const {from, to, gas, gasPrice, maxPriorityFeePerGas, value, data} = tx;
  const {result: block} = await elRpc(
    handler,
    "eth_getBlockByHash",
    [bufferToHex(executionPayload.blockHash), true],
    true
  );

  if (!block) {
    throw new Error(`Block not found: ${bufferToHex(executionPayload.blockHash)}`);
  }

  const {execResult} = await vm.evm.runCall({
    caller: from ? Address.fromString(from) : undefined,
    to: to ? Address.fromString(to) : undefined,
    gasLimit: hexToBigInt(gas ?? block.gasLimit),
    gasPrice: hexToBigInt(gasPrice ?? maxPriorityFeePerGas ?? "0x0"),
    value: hexToBigInt(value ?? "0x0"),
    data: data ? hexToBuffer(data) : undefined,
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
  handler,
  tx,
  vm,
  executionPayload,
  network,
}: {
  handler: ELApiHandlers["eth_getBlockByHash"];
  tx: ELTransaction;
  vm: VM;
  executionPayload: allForks.ExecutionPayload;
  network: NetworkName;
}): Promise<RunTxResult> {
  const {result: block} = await elRpc(
    handler,
    "eth_getBlockByHash",
    [bufferToHex(executionPayload.blockHash), true],
    true
  );

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
  executionPayload: allForks.ExecutionPayload,
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
