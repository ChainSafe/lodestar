import {CompositeType, CompositeView, CompositeViewDU, ContainerType, ValueOf} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {ssz as altairSsz} from "./altair/index.js";
import {ssz as bellatrixSsz} from "./bellatrix/index.js";
import {ssz as capellaSsz} from "./capella/index.js";
import {ssz as denebSsz} from "./deneb/index.js";
import {ssz as eip8025Ssz} from "./eip8025/index.js";
import {ssz as electraSsz} from "./electra/index.js";
import {ssz as fuluSsz} from "./fulu/index.js";
import {ssz as gloasSsz} from "./gloas/index.js";
import {ssz as hezeSsz} from "./heze/index.js";
import {ssz as phase0Ssz} from "./phase0/index.js";
import {ssz as pqSsz} from "./pq/index.js";

export * from "./primitive/sszTypes.js";

// Each fork is a superset of the previous one, with the types it changes overridden,
// so a fork's subdirectory only declares the types that change in it.
// `pq` and `heze` both build on gloas.
export const phase0 = {...phase0Ssz};
export const altair = {...phase0Ssz, ...altairSsz};
export const bellatrix = {...phase0Ssz, ...altairSsz, ...bellatrixSsz};
export const capella = {...phase0Ssz, ...altairSsz, ...bellatrixSsz, ...capellaSsz};
export const deneb = {...phase0Ssz, ...altairSsz, ...bellatrixSsz, ...capellaSsz, ...denebSsz};
export const electra = {...phase0Ssz, ...altairSsz, ...bellatrixSsz, ...capellaSsz, ...denebSsz, ...electraSsz};
export const fulu = {
  ...phase0Ssz,
  ...altairSsz,
  ...bellatrixSsz,
  ...capellaSsz,
  ...denebSsz,
  ...electraSsz,
  ...fuluSsz,
};
export const gloas = {
  ...phase0Ssz,
  ...altairSsz,
  ...bellatrixSsz,
  ...capellaSsz,
  ...denebSsz,
  ...electraSsz,
  ...fuluSsz,
  ...gloasSsz,
};
export const pq = {...gloas, ...pqSsz};
export const heze = {...gloas, ...hezeSsz};

/**
 * Index the ssz types that differ by fork
 * A record of AllForksSSZTypes indexed by fork
 */
// Annotated with `typeof` so that the declaration file names each fork's types instead of inlining them
const typesByFork: {
  [ForkName.phase0]: typeof phase0;
  [ForkName.altair]: typeof altair;
  [ForkName.bellatrix]: typeof bellatrix;
  [ForkName.capella]: typeof capella;
  [ForkName.deneb]: typeof deneb;
  [ForkName.electra]: typeof electra;
  [ForkName.fulu]: typeof fulu;
  [ForkName.gloas]: typeof gloas;
  [ForkName.pq]: typeof pq;
  [ForkName.heze]: typeof heze;
} = {
  [ForkName.phase0]: phase0,
  [ForkName.altair]: altair,
  [ForkName.bellatrix]: bellatrix,
  [ForkName.capella]: capella,
  [ForkName.deneb]: deneb,
  [ForkName.electra]: electra,
  [ForkName.fulu]: fulu,
  [ForkName.gloas]: gloas,
  [ForkName.pq]: pq,
  [ForkName.heze]: heze,
};

export const eip8025 = eip8025Ssz;

/**
 * A type of union of forks must accept as any parameter the UNION of all fork types.
 */

// biome-ignore lint/suspicious/noExplicitAny: We need to use `any` type here
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
