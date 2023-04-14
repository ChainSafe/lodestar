import {Block} from "@ethereumjs/block";
import {Common, CustomChain, Hardfork} from "@ethereumjs/common";
import {RLP} from "@ethereumjs/rlp";
import {Trie} from "@ethereumjs/trie";
import {Account, KECCAK256_NULL_S} from "@ethereumjs/util";
import {keccak256} from "ethereum-cryptography/keccak.js";
import {NetworkName} from "@lodestar/config/networks";
import {Bytes32, allForks} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {ELBlock, ELProof, ELStorageProof, HexString} from "../types.js";
import {blockDataFromELBlock, bufferToHex, hexToBuffer, padLeft} from "./conversion.js";

const emptyAccountSerialize = new Account().serialize();
const storageKeyLength = 32;

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

      const isStorageValid =
        (!expectedStorageRLP && sp.value === "0x0") ||
        (!!expectedStorageRLP && expectedStorageRLP.equals(RLP.encode(sp.value)));
      if (!isStorageValid) return false;
    } catch (err) {
      logger.error("Error verifying storage keys", undefined, err as Error);
      return false;
    }
  }

  return true;
}

function networkToChainCommon(network: NetworkName): Common {
  switch (network) {
    case "mainnet":
    case "goerli":
    case "ropsten":
    case "sepolia":
      // TODO: Not sure how to detect the fork during runtime
      return new Common({chain: network, hardfork: Hardfork.Shanghai});
    case "gnosis":
      return new Common({chain: CustomChain.xDaiChain});
    default:
      throw new Error(`Non supported network "${network}"`);
  }
}

export async function isValidBlock({
  executionPayload,
  block,
  logger,
  network,
}: {
  executionPayload: allForks.ExecutionPayload;
  block: ELBlock;
  logger: Logger;
  network: NetworkName;
}): Promise<boolean> {
  const common = networkToChainCommon(network);
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
