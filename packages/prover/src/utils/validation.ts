import {Block} from "@ethereumjs/block";
import {RLP} from "@ethereumjs/rlp";
import {Trie} from "@ethereumjs/trie";
import {Account, KECCAK256_NULL_S} from "@ethereumjs/util";
import {keccak256} from "ethereum-cryptography/keccak.js";
import {Bytes32, allForks} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {ChainForkConfig} from "@lodestar/config";
import {ELBlock, ELProof, ELStorageProof, HexString} from "../types.js";
import {blockDataFromELBlock, bufferToHex, hexToBuffer, padLeft} from "./conversion.js";
import {getChainCommon} from "./execution.js";

const emptyAccountSerialize = new Account().serialize();
const storageKeyLength = 32;

export function isBlockNumber(block: number | string): boolean {
  if (typeof block === "number") {
    return true;
  }

  // If block is hex and less than 32 byte long it is a block number, else it's a block hash
  return hexToBuffer(block).byteLength < 32;
}

export async function isValidAccount({
  address,
  stateRoot,
  proof,
  logger,
}: {
  address: HexString;
  stateRoot: Bytes32;
  proof: ELProof;
  logger: Logger;
}): Promise<boolean> {
  const trie = await Trie.create();
  const key = keccak256(hexToBuffer(address));

  try {
    const expectedAccountRLP = await trie.verifyProof(
      Buffer.from(stateRoot),
      Buffer.from(key),
      proof.accountProof.map(hexToBuffer)
    );

    // Shresth Agrawal (2022) Patronum source code. https://github.com/lightclients/patronum
    const account = Account.fromAccountData({
      nonce: BigInt(proof.nonce),
      balance: BigInt(proof.balance),
      storageRoot: proof.storageHash,
      codeHash: proof.codeHash,
    });
    return account.serialize().equals(expectedAccountRLP ? expectedAccountRLP : emptyAccountSerialize);
  } catch (err) {
    logger.error("Error verifying account proof", undefined, err as Error);
    return false;
  }
}

export async function isValidStorageKeys({
  storageKeys,
  proof,
  logger,
}: {
  storageKeys: HexString[];
  proof: ELStorageProof;
  logger: Logger;
}): Promise<boolean> {
  const trie = await Trie.create();

  for (let i = 0; i < storageKeys.length; i++) {
    const sp = proof.storageProof[i];
    const key = keccak256(padLeft(hexToBuffer(storageKeys[i]), storageKeyLength));
    try {
      const expectedStorageRLP = await trie.verifyProof(
        hexToBuffer(proof.storageHash),
        Buffer.from(key),
        sp.proof.map(hexToBuffer)
      );

      // buffer.equals is not compatible with Uint8Array for browser
      // so we need to convert the output of RLP.encode to Buffer first
      const isStorageValid =
        (!expectedStorageRLP && sp.value === "0x0") ||
        (!!expectedStorageRLP && expectedStorageRLP.equals(Buffer.from(RLP.encode(sp.value))));
      if (!isStorageValid) return false;
    } catch (err) {
      logger.error("Error verifying storage keys", undefined, err as Error);
      return false;
    }
  }

  return true;
}

export async function isValidBlock({
  executionPayload,
  block,
  logger,
  config,
}: {
  executionPayload: allForks.ExecutionPayload;
  block: ELBlock;
  logger: Logger;
  config: ChainForkConfig;
}): Promise<boolean> {
  const common = getChainCommon(config.PRESET_BASE);
  common.setHardforkByBlockNumber(executionPayload.blockNumber, undefined, executionPayload.timestamp);

  const blockObject = Block.fromBlockData(blockDataFromELBlock(block), {common});

  if (bufferToHex(executionPayload.blockHash) !== bufferToHex(blockObject.hash())) {
    logger.error("Block hash does not match", {
      rpcBlockHash: bufferToHex(blockObject.hash()),
      beaconExecutionBlockHash: bufferToHex(executionPayload.blockHash),
    });

    return false;
  }

  if (bufferToHex(executionPayload.parentHash) !== bufferToHex(blockObject.header.parentHash)) {
    logger.error("Block parent hash does not match", {
      rpcBlockHash: bufferToHex(blockObject.header.parentHash),
      beaconExecutionBlockHash: bufferToHex(executionPayload.parentHash),
    });

    return false;
  }

  if (!(await blockObject.validateTransactionsTrie())) {
    logger.error("Block transactions could not be verified.", {
      blockHash: bufferToHex(blockObject.hash()),
      blockNumber: blockObject.header.number,
    });

    return false;
  }

  return true;
}

export async function isValidCodeHash({
  codeHash,
  codeResponse,
}: {
  codeHash: string;
  codeResponse: string;
  logger: Logger;
}): Promise<boolean> {
  // if there is no code hash for that address
  if (codeResponse === "0x" && codeHash === `0x${KECCAK256_NULL_S}`) return true;

  return bufferToHex(keccak256(hexToBuffer(codeResponse))) === codeHash;
}

export function isNullish<T>(val: T | undefined | null): val is null | undefined {
  return val === null || val === undefined;
}

export function isPresent<T>(val: T | undefined | null): val is T {
  return !isNullish(val);
}
