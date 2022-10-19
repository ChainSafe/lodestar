import {CompositeType, ContainerType, ValueOf, CompositeView, CompositeViewDU} from "@chainsafe/ssz";
import {ForkName, ExecutionFork} from "@lodestar/params";

import {allForks} from "./sszTypes.js";

// Re-export union types for types that are _known_ to differ

export type BlindedOrFull = "blinded" | "full";

export type BeaconBlockBody<F extends ForkName = ForkName, B extends BlindedOrFull = "full"> = ValueOf<
  F extends ExecutionFork
    ? B extends "full"
      ? typeof allForks[F]["BeaconBlockBody"]
      : typeof allForks[F]["BlindedBeaconBlockBody"]
    : B extends "full"
    ? typeof allForks[F]["BeaconBlockBody"]
    : never
>;

export type BeaconBlock<F extends ForkName = ForkName, B extends BlindedOrFull = "full"> = ValueOf<
  F extends ExecutionFork
    ? B extends "full"
      ? typeof allForks[F]["BeaconBlock"]
      : typeof allForks[F]["BlindedBeaconBlock"]
    : B extends "full"
    ? typeof allForks[F]["BeaconBlock"]
    : never
>;

export type SignedBeaconBlock<F extends ForkName = ForkName, B extends BlindedOrFull = "full"> = ValueOf<
  F extends ExecutionFork
    ? B extends "full"
      ? typeof allForks[F]["SignedBeaconBlock"]
      : typeof allForks[F]["SignedBlindedBeaconBlock"]
    : B extends "full"
    ? typeof allForks[F]["SignedBeaconBlock"]
    : never
>;

export type BeaconState<F extends ForkName = ForkName> = ValueOf<typeof allForks[F]["BeaconState"]>;

export type Metadata<F extends ForkName = ForkName> = ValueOf<typeof allForks[F]["Metadata"]>;

// These two additional types will also change bellatrix forward
export type ExecutionPayload<F extends ExecutionFork = ExecutionFork> = ValueOf<typeof allForks[F]["ExecutionPayload"]>;
export type ExecutionPayloadHeader<F extends ExecutionFork = ExecutionFork> = ValueOf<
  typeof allForks[F]["ExecutionPayloadHeader"]
>;

/**
 * Types known to change between forks
 */
export type AllForksTypes = {
  BeaconBlockBody: BeaconBlockBody;
  BeaconBlock: BeaconBlock;
  SignedBeaconBlock: SignedBeaconBlock;
  BeaconState: BeaconState;
  Metadata: Metadata;
  ExecutionPayload: ExecutionPayload;
  ExecutionPayloadHeader: ExecutionPayloadHeader;
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
export type SSZTypes<F extends ForkName = ForkName> = {
  [K in keyof typeof allForks[F]]: AllForksTypeOf<typeof allForks[F][K]>;
};
