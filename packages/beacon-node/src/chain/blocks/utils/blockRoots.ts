import {symbolCachedPermanentRoot} from "@chainsafe/ssz";
import {signedBlockRoots} from "@lodestar/native/block-roots";
import {ForkName, ForkSeq} from "@lodestar/params";
import {SignedBeaconBlock} from "@lodestar/types";

type ValueWithCachedRoot = {[symbolCachedPermanentRoot]?: Uint8Array};

const transactionsRootByBlock = new WeakMap<SignedBeaconBlock, Uint8Array>();

/**
 * Compute the roots of a block natively from its serialization and seed the SSZ root caches of `signedBlock`,
 * so `hashTreeRoot` of the block or its body does not merkleize the execution payload transactions in JS.
 *
 * `serializedData` must be the serialization of `signedBlock` for `fork`.
 * The caller must use the addon's compiled preset without custom SSZ limits.
 */
export function computeBlockRoots(fork: ForkName, signedBlock: SignedBeaconBlock, serializedData: Uint8Array): void {
  const roots = signedBlockRoots(ForkSeq[fork], serializedData);
  (signedBlock.message as ValueWithCachedRoot)[symbolCachedPermanentRoot] = roots.subarray(0, 32);
  (signedBlock.message.body as ValueWithCachedRoot)[symbolCachedPermanentRoot] = roots.subarray(32, 64);
  if (roots.length === 96) {
    transactionsRootByBlock.set(signedBlock, roots.subarray(64, 96));
  }
}

/** Root of the execution payload transactions of a block seeded with `computeBlockRoots` */
export function getSeededTransactionsRoot(signedBlock: object): Uint8Array | undefined {
  return transactionsRootByBlock.get(signedBlock as SignedBeaconBlock);
}
