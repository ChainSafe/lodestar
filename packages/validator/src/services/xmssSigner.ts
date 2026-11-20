import {createHash} from "node:crypto";
import {XMSS_PUBLIC_KEY_SIZE, XmssSecretKey} from "@lodestar/native/leanvm";
import {VrfTree} from "@lodestar/native/vrf-tree";
import {
  LEAF_OFFSET_AGGREGATE_AND_PROOF,
  LEAF_OFFSET_BEACON_PROPOSER,
  LEAF_OFFSET_EXECUTION_PAYLOAD_ENVELOPE,
  LEAF_OFFSET_PROPOSER_PREFERENCES,
  LEAF_OFFSET_PTC_ATTESTER,
} from "@lodestar/params";
import {computeEpochAtSlot, computeXmssAttestationLeafIndex, computeXmssLeafIndex} from "@lodestar/state-transition";
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
    default:
      throw Error(`A pq validator does not sign ${signableMessage.type}`);
  }
}

/**
 * Where a leanXMSS key's trees are kept between runs: its public key, then the trees. Building
 * them takes seconds a key, loading them does not, and neither part is secret.
 */
export type XmssTreeStore = {
  read(): Uint8Array | null;
  write(bytes: Uint8Array): void;
};

/** The key of `seed`, with the trees in `store` if they are its own and built otherwise */
async function loadXmssKey(seed: Uint8Array, store?: XmssTreeStore): Promise<XmssSecretKey> {
  const stored = store?.read();
  if (stored && stored.length > XMSS_PUBLIC_KEY_SIZE) {
    try {
      return await XmssSecretKey.fromCache(
        seed,
        stored.subarray(0, XMSS_PUBLIC_KEY_SIZE),
        stored.subarray(XMSS_PUBLIC_KEY_SIZE)
      );
    } catch (e) {
      if (!(e as Error).message.includes("InvalidCache")) throw e;
    }
  }
  return XmssSecretKey.fromSeed(seed);
}

/** A pq validator's secrets: its leanXMSS key and its VRF tree */
export class XmssSigner {
  /** Bottom trees of the key that `treeStore` holds */
  private readonly storedTrees = new Set<number>();

  private constructor(
    readonly publicKey: Uint8Array,
    private readonly key: XmssSecretKey,
    private readonly vrfTree: VrfTree,
    private readonly treeStore?: XmssTreeStore
  ) {}

  /**
   * `vrfPopulatedDepth` below the tree's depth leaves later slots without a secret: for test
   * networks only.
   */
  static async init(seed: Uint8Array, vrfSeed: Uint8Array, vrfPopulatedDepth: number): Promise<XmssSigner> {
    const [key, vrfTree] = await Promise.all([XmssSecretKey.fromSeed(seed), VrfTree.build(vrfSeed, vrfPopulatedDepth)]);
    return new XmssSigner(key.toPublicKey(), key, vrfTree);
  }

  /**
   * The pq validator of a BLS keystore, as the devnet genesis tooling derives it: both seeds are
   * hashes of the keystore's secret key.
   *
   * Only the first 2^20 slots of its VRF tree are hashed here. A full tree takes 2^32 hashes, so
   * what stands above those slots comes from `vrfStates`, precomputed states of full trees with
   * this key's among them. Without `vrfStates` the other leaves are zero, as the genesis tooling
   * had it before it moved to full trees.
   */
  static async fromBlsSecretKey(
    secretKey: Uint8Array,
    vrfStates?: Uint8Array,
    treeStore?: XmssTreeStore
  ): Promise<XmssSigner> {
    const seed = createHash("sha256").update("leanxmss-seed").update(secretKey).digest();
    const vrfSeed = createHash("sha256").update("vrf-seed").update(secretKey).digest();
    const [key, vrfTree] = await Promise.all([
      loadXmssKey(seed, treeStore),
      VrfTree.build(vrfSeed, KEYSTORE_VRF_POPULATED_DEPTH, vrfStates),
    ]);
    return new XmssSigner(key.toPublicKey(), key, vrfTree, treeStore);
  }

  get vrfRoot(): Uint8Array {
    return this.vrfTree.root();
  }

  /** The leaf of `slot` then its Merkle branch, concatenated */
  vrfProof(slot: Slot): Uint8Array {
    return this.vrfTree.proof(slot);
  }

  /**
   * Builds the two bottom trees of the key that hold the leaves of `slot`, one for its attestation
   * and one for its other messages. The first signature in a bottom tree otherwise waits seconds
   * for it. The key keeps the trees it used last.
   */
  async prepare(slot: Slot): Promise<void> {
    const leaves = [computeXmssAttestationLeafIndex(computeEpochAtSlot(slot)), computeXmssLeafIndex(slot, 0)];
    await Promise.all(leaves.map((leaf) => this.key.prepare(leaf)));

    if (!this.treeStore) return;
    const trees = leaves.map((leaf) => leaf >>> XMSS_BOTTOM_TREE_HEIGHT);
    if (trees.every((tree) => this.storedTrees.has(tree))) return;
    this.treeStore.write(Buffer.concat([this.publicKey, this.key.toCache()]));
    for (const tree of trees) this.storedTrees.add(tree);
  }

  /**
   * A leaf must sign one message only: a second exposes its one-time key. The caller keeps the
   * record of what each leaf signed.
   */
  async sign(signingRoot: Uint8Array, leafIndex: number): Promise<Uint8Array> {
    return this.key.sign(signingRoot, leafIndex);
  }
}

/** A leaf index names its bottom tree above this many bits */
const XMSS_BOTTOM_TREE_HEIGHT = 16;

/** Slots a keystore's validator has a VRF proof for: the devnet convention */
const KEYSTORE_VRF_POPULATED_DEPTH = 20;

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

const interopSigners = new Map<number, Promise<XmssSigner>>();

/**
 * TEST NETWORKS ONLY: the pq validator whose secrets derive from `index` alone.
 *
 * Kept once built: `lodestar dev` needs each for its genesis state and again for its validator
 * client, and a key takes seconds to generate.
 */
export function interopXmssSigner(index: number): Promise<XmssSigner> {
  let signer = interopSigners.get(index);
  if (!signer) {
    signer = XmssSigner.init(
      interopSeed("lodestar interop xmss", index),
      interopSeed("lodestar interop vrf", index),
      INTEROP_VRF_POPULATED_DEPTH
    );
    interopSigners.set(index, signer);
  }
  return signer;
}
