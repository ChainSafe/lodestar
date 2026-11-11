import {createHash} from "node:crypto";
import {XmssSecretKey} from "@lodestar/native/leanvm";
import {VrfTree} from "@lodestar/native/vrf-tree";
import {
  LEAF_OFFSET_AGGREGATE_AND_PROOF,
  LEAF_OFFSET_BEACON_PROPOSER,
  LEAF_OFFSET_EXECUTION_PAYLOAD_ENVELOPE,
  LEAF_OFFSET_PROPOSER_PREFERENCES,
  LEAF_OFFSET_PTC_ATTESTER,
  RESERVED_LEAF_VOLUNTARY_EXIT,
  XMSS_ATTESTATION_LEAVES,
  XMSS_RESERVED_LEAVES,
} from "@lodestar/params";
import {computeXmssAttestationLeafIndex, computeXmssLeafIndex} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {SignableMessage, SignableMessageType} from "../util/externalSignerClient.js";

/** What a pq validator answers a signing request with: a leaf to sign at, or its VRF proof for a slot */
export type XmssSigningTarget = {leafIndex: number} | {vrfSlot: Slot};

/**
 * The leaf a message is signed at. The spec derives it from the message's type and its slot or
 * epoch, so that an honest validator never signs two messages at one leaf.
 *
 * The RANDAO reveal and the aggregator selection proof are not signatures from pq: both are the
 * validator's VRF proof for the slot.
 */
export function getXmssSigningTarget(signableMessage: SignableMessage, signingSlot: Slot): XmssSigningTarget {
  switch (signableMessage.type) {
    case SignableMessageType.RANDAO_REVEAL:
    case SignableMessageType.AGGREGATION_SLOT:
      return {vrfSlot: signingSlot};
    case SignableMessageType.ATTESTATION:
      return {leafIndex: computeXmssAttestationLeafIndex(signableMessage.data.target.epoch)};
    case SignableMessageType.BLOCK_V2:
      return {leafIndex: computeXmssLeafIndex(signableMessage.data.slot, LEAF_OFFSET_BEACON_PROPOSER)};
    case SignableMessageType.AGGREGATE_AND_PROOF_V2:
      return {
        leafIndex: computeXmssLeafIndex(signableMessage.data.aggregate.data.slot, LEAF_OFFSET_AGGREGATE_AND_PROOF),
      };
    case SignableMessageType.PAYLOAD_ATTESTATION_MESSAGE:
      return {leafIndex: computeXmssLeafIndex(signableMessage.data.slot, LEAF_OFFSET_PTC_ATTESTER)};
    case SignableMessageType.PROPOSER_PREFERENCES:
      return {
        leafIndex: computeXmssLeafIndex(signableMessage.data.proposalSlot, LEAF_OFFSET_PROPOSER_PREFERENCES),
      };
    case SignableMessageType.EXECUTION_PAYLOAD_ENVELOPE:
      return {leafIndex: computeXmssLeafIndex(signingSlot, LEAF_OFFSET_EXECUTION_PAYLOAD_ENVELOPE)};
    case SignableMessageType.VOLUNTARY_EXIT:
      return {leafIndex: RESERVED_LEAF_VOLUNTARY_EXIT};
    default:
      throw Error(`A pq validator does not sign ${signableMessage.type}`);
  }
}

/**
 * A pq validator's secrets: its leanXMSS key and its VRF tree.
 *
 * A leanXMSS key keeps the last bottom tree it signed in, 2^16 leaves, and rebuilds one on a
 * miss. Attestations and per-slot messages have leaves in different bottom trees, so one instance
 * of the key would rebuild on every switch between them. Two instances of the same key, one for
 * each range, each stay in their tree.
 */
export class XmssSigner {
  private constructor(
    readonly publicKey: Uint8Array,
    private readonly attestationKey: XmssSecretKey,
    private readonly slotKey: XmssSecretKey,
    private readonly vrfTree: VrfTree
  ) {}

  /**
   * `vrfPopulatedDepth` below the tree's depth leaves later slots without a secret: for test
   * networks only.
   */
  static async init(seed: Uint8Array, vrfSeed: Uint8Array, vrfPopulatedDepth: number): Promise<XmssSigner> {
    const [attestationKey, slotKey, vrfTree] = await Promise.all([
      XmssSecretKey.fromSeed(seed),
      XmssSecretKey.fromSeed(seed),
      VrfTree.build(vrfSeed, vrfPopulatedDepth),
    ]);
    return new XmssSigner(attestationKey.toPublicKey(), attestationKey, slotKey, vrfTree);
  }

  get vrfRoot(): Uint8Array {
    return this.vrfTree.root();
  }

  /** The leaf of `slot` then its Merkle branch, concatenated */
  vrfProof(slot: Slot): Uint8Array {
    return this.vrfTree.proof(slot);
  }

  /**
   * A leaf must sign one message only: a second exposes its one-time key. The caller keeps the
   * record of what each leaf signed.
   */
  async sign(signingRoot: Uint8Array, leafIndex: number): Promise<Uint8Array> {
    const key = leafIndex < XMSS_RESERVED_LEAVES + XMSS_ATTESTATION_LEAVES ? this.attestationKey : this.slotKey;
    return key.sign(signingRoot, leafIndex);
  }
}

/**
 * Slots with a VRF secret for an interop validator. Far fewer than a real tree's, which takes
 * 2^32 hashes to build: interop keys are for test networks.
 */
export const INTEROP_VRF_POPULATED_DEPTH = 20;

function interopSeed(label: string, index: number): Uint8Array {
  const input = new Uint8Array(label.length + 8);
  input.set(Buffer.from(label, "ascii"));
  new DataView(input.buffer).setBigUint64(label.length, BigInt(index), true);
  return createHash("sha256").update(input).digest();
}

/** TEST NETWORKS ONLY: the pq validator whose secrets derive from `index` alone */
export function interopXmssSigner(index: number): Promise<XmssSigner> {
  return XmssSigner.init(
    interopSeed("lodestar interop xmss", index),
    interopSeed("lodestar interop vrf", index),
    INTEROP_VRF_POPULATED_DEPTH
  );
}
