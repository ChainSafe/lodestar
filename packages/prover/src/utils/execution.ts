import {Block} from "@ethereumjs/block";
import {RLP} from "@ethereumjs/rlp";
import {Trie} from "@ethereumjs/trie";
import {Account} from "@ethereumjs/util";
import {keccak256} from "ethereum-cryptography/keccak.js";
import {Bytes32, allForks} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {ELRequestHandler} from "../interfaces.js";
import {ELBlock, ELProof, ELStorageProof, HexString} from "../types.js";
import {blockDataFromELBlock, bufferToHex, hexToBuffer, padLeft} from "./conversion.js";

const emptyAccountSerialize = new Account().serialize();
const storageKeyLength = 32;

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

export async function isValidBlock({
  executionPayload,
  block,
  logger,
}: {
  executionPayload: allForks.ExecutionPayload;
  block: ELBlock;
  logger: Logger;
}): Promise<boolean> {
  const blockObject = Block.fromBlockData(blockDataFromELBlock(block));

  if (bufferToHex(executionPayload.blockHash) !== bufferToHex(blockObject.hash())) {
    logger.error("Block hash does not match", {
      rpcBlockHash: bufferToHex(blockObject.hash()),
      beaconExecutionBlockHash: bufferToHex(executionPayload.blockHash),
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
