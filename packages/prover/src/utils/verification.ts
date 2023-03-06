import {RLP} from "@ethereumjs/rlp";
import {Trie} from "@ethereumjs/trie";
import {Account} from "@ethereumjs/util";
import {keccak256} from "ethereum-cryptography/keccak.js";
import {Bytes32} from "@lodestar/types";
import {ELProof} from "../types.js";
import {hexToBuffer, padLeft} from "./conversion.js";

const emptyAccountSerialize = new Account().serialize();
const storageKeyLength = 32;

export async function isValidAccount({
  address,
  stateRoot,
  proof,
}: {
  address: Bytes32;
  stateRoot: Uint8Array;
  proof: ELProof;
}): Promise<boolean> {
  const trie = await Trie.create();
  const key = keccak256(address);

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
}

export async function isValidStorageKeys({
  storageKeys,
  proof,
}: {
  storageKeys: Bytes32[];
  proof: ELProof;
}): Promise<boolean> {
  const trie = await Trie.create();

  for (let i = 0; i < storageKeys.length; i++) {
    const sp = proof.storageProof[i];
    const key = keccak256(padLeft(storageKeys[i], storageKeyLength));
    const expectedStorageRLP = await trie.verifyProof(
      hexToBuffer(proof.storageHash),
      Buffer.from(key),
      sp.proof.map(hexToBuffer)
    );
    const isStorageValid =
      (!expectedStorageRLP && sp.value === "0x0") ||
      (!!expectedStorageRLP && expectedStorageRLP.equals(RLP.encode(sp.value)));
    if (!isStorageValid) return false;
  }

  return true;
}
