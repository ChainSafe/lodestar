import {CompositeType, CompositeView, CompositeViewDU, ContainerType, ValueOf} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {ssz as phase0} from "./phase0/index.js";
import {ssz as altair} from "./altair/index.js";
import {ssz as bellatrix} from "./bellatrix/index.js";
import {ssz as capella} from "./capella/index.js";
import {ssz as deneb} from "./deneb/index.js";
import {ssz as electra} from "./electra/index.js";

export * from "./primitive/sszTypes.js";
export {phase0, altair, bellatrix, capella, deneb, electra};

/**
 * Index the ssz types that differ by fork
 * A record of AllForksSSZTypes indexed by fork
 */
const typesByFork = {
  [ForkName.phase0]: {...phase0},
  [ForkName.altair]: {...phase0, ...altair},
  [ForkName.bellatrix]: {...phase0, ...altair, ...bellatrix},
  [ForkName.capella]: {...phase0, ...altair, ...bellatrix, ...capella},
  [ForkName.deneb]: {...phase0, ...altair, ...bellatrix, ...capella, ...deneb},
  [ForkName.electra]: {...phase0, ...altair, ...bellatrix, ...capella, ...deneb, ...electra},
};

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
  return (
    typeName === undefined ? typesByFork[fork] : typesByFork[fork][typeName as keyof SSZTypesByFork[F]]
  ) as SSZTypesFor<F, K>;
}
