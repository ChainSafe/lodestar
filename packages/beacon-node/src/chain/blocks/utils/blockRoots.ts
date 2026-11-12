import {symbolCachedPermanentRoot} from "@chainsafe/ssz";
import {getPresetBase, signedBlockRoots} from "@lodestar/native/block-roots";
import {ACTIVE_PRESET, ForkName, ForkSeq} from "@lodestar/params";
import {userOverrides} from "@lodestar/params/setPreset";
import {SignedBeaconBlock} from "@lodestar/types";

type ValueWithCachedRoot = {[symbolCachedPermanentRoot]?: Uint8Array};

const transactionsRootByBlock = new WeakMap<SignedBeaconBlock, Uint8Array>();
const canComputeNativeRoots = getPresetBase() === ACTIVE_PRESET && Object.keys(userOverrides ?? {}).length === 0;

/**
 * Compute the roots of a block natively from its serialization and seed the SSZ root caches of `signedBlock`,
 * so `hashTreeRoot` of the block or its body does not merkleize the execution payload transactions in JS.
 *
 * `serializedData` must be the serialization of `signedBlock` for `fork`.
 * If the presets differ or the runtime preset has overrides, leave root computation to JS SSZ.
 */
export function computeBlockRoots(fork: ForkName, signedBlock: SignedBeaconBlock, serializedData: Uint8Array): void {
  if (!canComputeNativeRoots) return;

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
