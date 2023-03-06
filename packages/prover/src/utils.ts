import {RLP} from "@ethereumjs/rlp";
import {Trie} from "@ethereumjs/trie";
import {Account} from "@ethereumjs/util";
import {keccak256} from "ethereum-cryptography/keccak.js";
import {ApiError} from "@lodestar/api";
import {Api} from "@lodestar/api/beacon";
import {GenesisData, Lightclient} from "@lodestar/light-client";
import {allForks, Bytes32, capella} from "@lodestar/types";
import {ELRequestMethod, SendAsyncProvider, SendProvider, Web3Provider} from "./interfaces.js";
import {ELProof} from "./types.js";

export function numberToHex(n: number | bigint): string {
  return "0x" + n.toString(16);
}

export function hexToNumber(n: string): number {
  return n.startsWith("0x") ? parseInt(n.slice(2), 16) : parseInt(n, 16);
}

export function bufferToHex(buffer: Buffer | Uint8Array): string {
  return "0x" + Buffer.from(buffer).toString("hex");
}

export function hexToBuffer(v: string): Buffer {
  return Buffer.from(v.replace("0x", ""));
}

export function padLeft(v: Uint8Array, length: number): Uint8Array {
  const buf = Buffer.alloc(length);
  Buffer.from(v).copy(buf, length - v.length);
  return buf;
}

const emptyAccountSerialize = new Account().serialize();
const storageKeyLength = 32;

export async function getELProof(
  handler: ELRequestMethod,
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
}: {
  address: Bytes32;
  storageKeys: Bytes32[];
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
  stateRoot: Uint8Array;
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

export async function getGenesisData(api: Pick<Api, "beacon">): Promise<GenesisData> {
  const res = await api.beacon.getGenesis();
  ApiError.assert(res);

  return {
    genesisTime: Number(res.response.data.genesisTime),
    genesisValidatorsRoot: res.response.data.genesisValidatorsRoot,
  };
}

export function isSendProvider(provider: Web3Provider): provider is SendProvider {
  return "send" in provider && typeof provider.send === "function" && provider.send.length > 1;
}

export function isSendAsyncProvider(provider: Web3Provider): provider is SendAsyncProvider {
  return "sendAsync" in provider && typeof provider.sendAsync === "function";
}

export function assertLightClient(client?: Lightclient): asserts client is Lightclient {
  if (!client) {
    throw new Error("Light client is not initialized yet.");
  }
}

export async function getExecutionPayloads(
  api: Api,
  startSlot: number,
  endSlot: number
): Promise<allForks.ExecutionPayload[]> {
  [startSlot, endSlot] = [Math.min(startSlot, endSlot), Math.max(startSlot, endSlot)];

  const payloads: allForks.ExecutionPayload[] = [];
  const res = await api.beacon.getBlockV2(endSlot);
  ApiError.assert(res);
  let payload = (res.response.data as capella.SignedBeaconBlock).message.body.executionPayload;

  for (let slot = endSlot - 1; slot >= startSlot; slot--) {
    const res = await api.beacon.getBlockV2(slot);
    ApiError.assert(res);
    const nextPayload = (res.response.data as capella.SignedBeaconBlock).message.body.executionPayload;
    if (payload.blockHash === nextPayload.parentHash) {
      payloads.push(payload);
    }
    payload = nextPayload;
  }
  payloads.push(payload);

  return payloads;
}
