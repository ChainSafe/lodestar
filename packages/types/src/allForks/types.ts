import {CompositeType, ContainerType, ValueOf, CompositeView, CompositeViewDU} from "@chainsafe/ssz";
import {ts as phase0} from "../phase0/index.js";
import {ts as altair} from "../altair/index.js";
import {ts as bellatrix} from "../bellatrix/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as altairSsz} from "../altair/index.js";
import {ssz as bellatrixSsz} from "../bellatrix/index.js";

// Re-export union types for types that are _known_ to differ

export type BeaconBlockBody = phase0.BeaconBlockBody | altair.BeaconBlockBody | bellatrix.BeaconBlockBody;
export type BeaconBlock = phase0.BeaconBlock | altair.BeaconBlock | bellatrix.BeaconBlock;
export type SignedBeaconBlock = phase0.SignedBeaconBlock | altair.SignedBeaconBlock | bellatrix.SignedBeaconBlock;
export type BeaconState = phase0.BeaconState | altair.BeaconState | bellatrix.BeaconState;
export type Metadata = phase0.Metadata | altair.Metadata;

/**
 * Types known to change between forks
 */
export type AllForksTypes = {
  BeaconBlockBody: BeaconBlockBody;
  BeaconBlock: BeaconBlock;
  SignedBeaconBlock: SignedBeaconBlock;
  BeaconState: BeaconState;
  Metadata: Metadata;
};

/**
 * An AllForks type must accept as any parameter the UNION of all fork types.
 * The generic argument of `AllForksTypeOf` must be the union of the fork types:
 *
 *
 * For example, `allForks.BeaconState.defaultValue()` must return
 * ```
 * phase0.BeaconState | altair.BeaconState | bellatrix.BeaconState
 * ```
 *
 * And `allForks.BeaconState.serialize()` must accept as parameter
 * ```
 * phase0.BeaconState | altair.BeaconState | bellatrix.BeaconState
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AllForksTypeOf<UnionOfForkTypes extends ContainerType<any>> = CompositeType<
  ValueOf<UnionOfForkTypes>,
  CompositeView<UnionOfForkTypes>,
  CompositeViewDU<UnionOfForkTypes>
>;

/**
 * SSZ Types known to change between forks.
 *
 * Re-wrapping a union of fields in a new ContainerType allows to pass a generic block to .serialize()
 * - .serialize() requires a value with ONLY the common fork fields
 * - .deserialize() and ValueOf return a value with ONLY the general fork fields
 */
export type AllForksSSZTypes = {
  BeaconBlockBody: AllForksTypeOf<
    typeof phase0Ssz.BeaconBlockBody | typeof altairSsz.BeaconBlockBody | typeof bellatrixSsz.BeaconBlockBody
  >;
  BeaconBlock: AllForksTypeOf<
    typeof phase0Ssz.BeaconBlock | typeof altairSsz.BeaconBlock | typeof bellatrixSsz.BeaconBlock
  >;
  SignedBeaconBlock: AllForksTypeOf<
    typeof phase0Ssz.SignedBeaconBlock | typeof altairSsz.SignedBeaconBlock | typeof bellatrixSsz.SignedBeaconBlock
  >;
  BeaconState: AllForksTypeOf<
    typeof phase0Ssz.BeaconState | typeof altairSsz.BeaconState | typeof bellatrixSsz.BeaconState
  >;
  Metadata: AllForksTypeOf<typeof phase0Ssz.Metadata | typeof altairSsz.Metadata>;
};
