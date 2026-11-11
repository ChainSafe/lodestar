import {digest} from "@chainsafe/as-sha256";
import {verifyXmssSignature} from "@lodestar/native/leanvm";
import {
  VRF_TREE_DEPTH,
  XMSS_ATTESTATION_LEAVES,
  XMSS_LEAVES_PER_SLOT,
  XMSS_RESERVED_LEAVES,
  XMSS_SIGNATURE_SIZE,
} from "@lodestar/params";
import {Epoch, Slot, pq} from "@lodestar/types";

const XMSS_REQUEST_PREFIX_SIZE = 16;
const LEGACY_XMSS_PUBKEY_DOMAIN = 0x00;
const LEGACY_VRF_ROOT_DOMAIN = 0x01;

/** The leaf at which an attestation is signed for target `epoch` */
export function computeXmssAttestationLeafIndex(epoch: Epoch): number {
  return XMSS_RESERVED_LEAVES + epoch;
}

/** The leaf at which the message of the type `leafOffset` is signed for `slot` */
export function computeXmssLeafIndex(slot: Slot, leafOffset: number): number {
  return XMSS_RESERVED_LEAVES + XMSS_ATTESTATION_LEAVES + slot * XMSS_LEAVES_PER_SLOT + leafOffset;
}

/** The leaf a signature says it was made at. `verifyXmss` proves it. */
export function getXmssSignatureLeafIndex(signature: Uint8Array): number {
  return new DataView(signature.buffer, signature.byteOffset, 4).getUint32(0, true);
}

/** True only if `signature` is `pubkey`'s over `signingRoot` at `leafIndex` */
export function verifyXmss(
  pubkey: pq.XMSSPubkey,
  leafIndex: number,
  signingRoot: Uint8Array,
  signature: pq.XMSSSignature
): boolean {
  if (signature.length !== XMSS_SIGNATURE_SIZE) return false;
  if (getXmssSignatureLeafIndex(signature) !== leafIndex) return false;
  return verifyXmssSignature(pubkey, signingRoot, signature);
}

/**
 * A request made before the fork names a compressed BLS public key, whose first byte has its top
 * bit set. One made after names 16 zero bytes then a leanXMSS public key.
 */
export function isLegacyPubkey(pubkey: Uint8Array): boolean {
  for (let i = 0; i < XMSS_REQUEST_PREFIX_SIZE; i++) {
    if (pubkey[i] !== 0) return true;
  }
  return false;
}

/** How a deposit or an execution request names a leanXMSS public key */
export function toRequestPubkey(pubkey: pq.XMSSPubkey): Uint8Array {
  const out = new Uint8Array(XMSS_REQUEST_PREFIX_SIZE + pubkey.length);
  out.set(pubkey, XMSS_REQUEST_PREFIX_SIZE);
  return out;
}

/** The leanXMSS public key a request's `pubkey` names, without regard for legacy requests */
export function fromRequestPubkey(pubkey: Uint8Array): pq.XMSSPubkey {
  return pubkey.subarray(XMSS_REQUEST_PREFIX_SIZE);
}

function legacyDigest(pubkey: Uint8Array, domain: number): Uint8Array {
  const input = new Uint8Array(pubkey.length + 1);
  input.set(pubkey);
  input[pubkey.length] = domain;
  return digest(input);
}

/** The leanXMSS public key that a deposit naming `pubkey` is for */
export function computeDepositPubkey(pubkey: Uint8Array): pq.XMSSPubkey {
  return isLegacyPubkey(pubkey) ? legacyDigest(pubkey, LEGACY_XMSS_PUBKEY_DOMAIN) : fromRequestPubkey(pubkey);
}

/** The VRF root of the validator that a deposit creates */
export function computeDepositVrfRoot(pubkey: Uint8Array, signature: Uint8Array): Uint8Array {
  return isLegacyPubkey(pubkey) ? legacyDigest(pubkey, LEGACY_VRF_ROOT_DOMAIN) : signature.subarray(0, 32);
}

/** Checks that `proof` opens the leaf for `slot` under `vrfRoot` */
export function isValidVrfProof(vrfRoot: Uint8Array, slot: Slot, proof: pq.VRFProof): boolean {
  if (proof.length !== VRF_TREE_DEPTH + 1) return false;
  let value = proof[0];
  const pair = new Uint8Array(64);
  for (let depth = 0; depth < VRF_TREE_DEPTH; depth++) {
    const sibling = proof[depth + 1];
    // Slots exceed 2**32, so no bitwise shift
    if (Math.floor(slot / 2 ** depth) % 2 === 1) {
      pair.set(sibling, 0);
      pair.set(value, 32);
    } else {
      pair.set(value, 0);
      pair.set(sibling, 32);
    }
    value = digest(pair);
  }
  return Buffer.compare(value, vrfRoot) === 0;
}
