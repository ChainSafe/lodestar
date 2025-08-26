import {CompositeType, CompositeView, CompositeViewDU, ContainerType, ValueOf} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {ssz as altairSsz} from "./altair/index.js";
import {ssz as bellatrixSsz} from "./bellatrix/index.js";
import {ssz as capellaSsz} from "./capella/index.js";
import {ssz as denebSsz} from "./deneb/index.js";
import {ssz as electraSsz} from "./electra/index.js";
import {ssz as fuluSsz} from "./fulu/index.js";
import {ssz as gloasSsz} from "./gloas/index.js";
import {ssz as phase0Ssz} from "./phase0/index.js";

export * from "./primitive/sszTypes.js";

/**
 * Index the ssz types that differ by fork
 * A record of AllForksSSZTypes indexed by fork
 */
const typesByFork = {
  [ForkName.phase0]: {...phase0Ssz},
  [ForkName.altair]: {...phase0Ssz, ...altairSsz},
  [ForkName.bellatrix]: {...phase0Ssz, ...altairSsz, ...bellatrixSsz},
  [ForkName.capella]: {...phase0Ssz, ...altairSsz, ...bellatrixSsz, ...capellaSsz},
  [ForkName.deneb]: {...phase0Ssz, ...altairSsz, ...bellatrixSsz, ...capellaSsz, ...denebSsz},
  [ForkName.electra]: {...phase0Ssz, ...altairSsz, ...bellatrixSsz, ...capellaSsz, ...denebSsz, ...electraSsz},
  [ForkName.fulu]: {...phase0Ssz, ...altairSsz, ...bellatrixSsz, ...capellaSsz, ...denebSsz, ...electraSsz, ...fuluSsz},
  [ForkName.gloas]: {
    ...phase0Ssz,
    ...altairSsz,
    ...bellatrixSsz,
    ...capellaSsz,
    ...denebSsz,
    ...electraSsz,
    ...fuluSsz,
    ...gloasSsz,
  },
};

// Export these types to ensure that each fork is a superset of the previous one (with overridden types obviously)
// This allows us to only declare types that change in each fork in each fork subdirectory

export const phase0 = typesByFork[ForkName.phase0];
export const altair = typesByFork[ForkName.altair];
export const bellatrix = typesByFork[ForkName.bellatrix];
export const capella = typesByFork[ForkName.capella];
export const deneb = typesByFork[ForkName.deneb];
export const electra = typesByFork[ForkName.electra];
export const fulu = typesByFork[ForkName.fulu];
export const gloas = typesByFork[ForkName.gloas];

/**
 * A type of union of forks must accept as any parameter the UNION of all fork types.
 */

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type UnionSSZForksTypeOf<UnionOfForkTypes extends ContainerType<any>> = CompositeType<
  ValueOf<UnionOfForkTypes>,
  CompositeView<UnionOfForkTypes>,
  CompositeViewDU<UnionOfForkTypes>
>;

type SSZTypesByFork = {
  [F in keyof typeof typesByFork]: {
    [T in keyof (typeof typesByFork)[F]]: (typeof typesByFork)[F][T];
  };
};

export type SSZTypesFor<F extends ForkName, K extends keyof SSZTypesByFork[F] | void = void> = K extends void
  ? // It compiles fine, need to debug the error
    // @ts-expect-error
    {[K2 in keyof SSZTypesByFork[F]]: UnionSSZForksTypeOf<SSZTypesByFork[F][K2]>}
  : // It compiles fine, need to debug the error
    // @ts-expect-error
    UnionSSZForksTypeOf<SSZTypesByFork[F][Exclude<K, void>]>;

export function sszTypesFor<F extends ForkName, K extends keyof SSZTypesByFork[F] | void = void>(
  fork: F,
  typeName?: K
): SSZTypesFor<F, K> {
  const sszTypes = typesByFork[fork];

  if (sszTypes === undefined) {
    throw Error(`SSZ types for fork ${fork} are not defined`);
  }

  return (typeName === undefined ? sszTypes : sszTypes[typeName as keyof SSZTypesByFork[F]]) as SSZTypesFor<F, K>;
}
