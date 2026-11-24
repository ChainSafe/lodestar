import {createHash, createHmac, timingSafeEqual} from "node:crypto";
import {XMSS_PUBLIC_KEY_SIZE, XmssSecretKey, xmssPublicParameter} from "@lodestar/native/leanvm";
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
import {toHex} from "@lodestar/utils";
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
 * Where a leanXMSS key's trees are kept between runs. Building them takes seconds a key, loading
 * them does not, and they hold no secret.
 */
export type XmssTreeStore = {
  read(): Uint8Array | null;
  write(bytes: Uint8Array): void;
};

/**
 * A key's trees built elsewhere, and the public key they belong to. The trees are checked against
 * the public key, so they may come from anywhere. The public key may not: a wrong one with trees
 * to match gives a key that signs for no validator.
 */
export type XmssTrees = {publicKey: Uint8Array; trees: Uint8Array};

function xmssSeed(blsSecretKey: Uint8Array): Uint8Array {
  return createHash("sha256").update("leanxmss-seed").update(blsSecretKey).digest();
}

/**
 * The public parameter of the leanXMSS key of a BLS keystore: the last 16 bytes of its public
 * key, which take no tree to derive. Enough to look the key's trees up before it is built.
 */
export function getXmssPublicParameter(blsSecretKey: Uint8Array): Uint8Array {
  return xmssPublicParameter(xmssSeed(blsSecretKey));
}

const TREE_TAG_SIZE = 32;

/**
 * A stored key: its public key, its trees, then a MAC of both under a key derived from the seed.
 * The trees are checked against the public key, which only the MAC vouches for.
 */
class SealedTrees {
  private readonly macKey: Uint8Array;

  constructor(
    private readonly store: XmssTreeStore,
    seed: Uint8Array
  ) {
    this.macKey = createHmac("sha256", seed).update("lodestar leanxmss trees").digest();
  }

  read(): {publicKey: Uint8Array; trees: Uint8Array} | null {
    const stored = this.store.read();
    if (!stored || stored.length < XMSS_PUBLIC_KEY_SIZE + TREE_TAG_SIZE) return null;
    const content = stored.subarray(0, stored.length - TREE_TAG_SIZE);
    if (!timingSafeEqual(this.tag(content), stored.subarray(content.length))) return null;
    return {publicKey: content.subarray(0, XMSS_PUBLIC_KEY_SIZE), trees: content.subarray(XMSS_PUBLIC_KEY_SIZE)};
  }

  write(publicKey: Uint8Array, trees: Uint8Array): void {
    const content = Buffer.concat([publicKey, trees]);
    this.store.write(Buffer.concat([content, this.tag(content)]));
  }

  private tag(content: Uint8Array): Uint8Array {
    return createHmac("sha256", this.macKey).update(content).digest();
  }
}

/**
 * Whether `store` holds trees that the leanXMSS key of a BLS keystore wrote: such a key needs
 * none from elsewhere.
 */
export function hasXmssTrees(blsSecretKey: Uint8Array, store: XmssTreeStore): boolean {
  return new SealedTrees(store, xmssSeed(blsSecretKey)).read() !== null;
}

/** Where a key's trees are from: those it stored, those it was given, or none, so it built them */
export type XmssTreesSource = "stored" | "given" | "built";

/** The key of `seed`, with its stored trees, else `trees`, else built */
async function loadXmssKey(
  seed: Uint8Array,
  stored?: SealedTrees,
  trees?: XmssTrees
): Promise<{key: XmssSecretKey; treesSource: XmssTreesSource}> {
  const storedTrees = stored?.read();
  const cached = storedTrees ?? trees;
  if (cached) {
    try {
      const key = await XmssSecretKey.fromCache(seed, cached.publicKey, cached.trees);
      return {key, treesSource: storedTrees ? "stored" : "given"};
    } catch (e) {
      if (!(e as Error).message.includes("InvalidCache")) throw e;
    }
  }
  return {key: await XmssSecretKey.fromSeed(seed), treesSource: "built"};
}

/** A pq validator's secrets: its leanXMSS key and its VRF tree */
export class XmssSigner {
  /** Bottom trees of the key that `treeStore` holds */
  private readonly storedTrees = new Set<number>();
  /** Bottom trees `prepare` was called for */
  private readonly preparedTrees = new Set<number>();
  private vrfTree: Promise<VrfTree> | null = null;
  private registeredVrfRoot: Uint8Array | null = null;

  private constructor(
    readonly publicKey: Uint8Array,
    private readonly key: XmssSecretKey,
    private readonly buildVrfTree: (threads?: number) => Promise<VrfTree>,
    readonly treesSource: XmssTreesSource,
    private readonly treeStore?: SealedTrees
  ) {}

  /**
   * `vrfPopulatedDepth` below the tree's depth leaves later slots without a secret: for test
   * networks only.
   */
  static async init(seed: Uint8Array, vrfSeed: Uint8Array, vrfPopulatedDepth: number): Promise<XmssSigner> {
    const key = await XmssSecretKey.fromSeed(seed);
    return new XmssSigner(
      key.toPublicKey(),
      key,
      (threads) => VrfTree.build(vrfSeed, vrfPopulatedDepth, undefined, threads),
      "built"
    );
  }

  /**
   * The pq validator of a BLS keystore, as the devnet genesis tooling derives it: both seeds are
   * hashes of the keystore's secret key.
   *
   * Only the first 2^20 slots of its VRF tree are hashed. A full tree takes 2^32 hashes, so what
   * stands above those slots comes from `vrfStates`, precomputed states of full trees with this
   * key's among them. Without `vrfStates` the other leaves are zero, as the genesis tooling had it
   * before it moved to full trees.
   *
   * The key's trees are those in `treeStore`, where the signer keeps them, else `trees`, else
   * built.
   */
  static async fromBlsSecretKey(
    secretKey: Uint8Array,
    opts: {vrfStates?: Uint8Array; treeStore?: XmssTreeStore; trees?: XmssTrees} = {}
  ): Promise<XmssSigner> {
    const seed = xmssSeed(secretKey);
    const vrfSeed = createHash("sha256").update("vrf-seed").update(secretKey).digest();
    const stored = opts.treeStore && new SealedTrees(opts.treeStore, seed);
    const {key, treesSource} = await loadXmssKey(seed, stored, opts.trees);
    return new XmssSigner(
      key.toPublicKey(),
      key,
      (threads) => VrfTree.build(vrfSeed, KEYSTORE_VRF_POPULATED_DEPTH, opts.vrfStates, threads),
      treesSource,
      stored
    );
  }

  /** The VRF root the state holds for the validator. A tree with another root is not its own. */
  setRegisteredVrfRoot(root: Uint8Array): void {
    this.registeredVrfRoot = root;
  }

  /**
   * Builds the VRF tree at the first call. Only a proposal needs it, and it takes about a second
   * of one core, so a signer is made without it. Rejects if the tree cannot be built, or is not
   * the one the state holds the root of.
   *
   * It is built on `threads` threads, every CPU if not given: a proposal waits for it. Ahead of
   * any proposal one thread does, and leaves the others to the validators' duties.
   */
  async getVrfRoot(threads?: number): Promise<Uint8Array> {
    this.vrfTree ??= this.buildVrfTree(threads);
    const root = (await this.vrfTree).root();
    if (this.registeredVrfRoot && Buffer.compare(root, this.registeredVrfRoot) !== 0) {
      throw Error(
        `VRF tree with root ${toHex(root)} is not the validator's in the state, ${toHex(this.registeredVrfRoot)}`
      );
    }
    return root;
  }

  /** The leaf of `slot` then its Merkle branch, concatenated */
  async vrfProof(slot: Slot): Promise<Uint8Array> {
    await this.getVrfRoot();
    return (await (this.vrfTree as Promise<VrfTree>)).proof(slot);
  }

  /**
   * Builds the two bottom trees of the key that hold the leaves of `slot`, one for its attestation
   * and one for its other messages. The first signature in a bottom tree otherwise waits seconds
   * for it. The key keeps the trees it used last.
   *
   * Returns whether it asked for a tree for the first time: one the key built, unless it came
   * with the trees the key was loaded from.
   */
  async prepare(slot: Slot): Promise<boolean> {
    const leaves = [computeXmssAttestationLeafIndex(computeEpochAtSlot(slot)), computeXmssLeafIndex(slot, 0)];
    await Promise.all(leaves.map((leaf) => this.key.prepare(leaf)));

    const trees = leaves.map((leaf) => leaf >>> XMSS_BOTTOM_TREE_HEIGHT);
    const isFirst = trees.some((tree) => !this.preparedTrees.has(tree));
    for (const tree of trees) this.preparedTrees.add(tree);

    if (this.treeStore && !trees.every((tree) => this.storedTrees.has(tree))) {
      this.treeStore.write(this.publicKey, this.key.toCache());
      for (const tree of trees) this.storedTrees.add(tree);
    }
    return isFirst;
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
