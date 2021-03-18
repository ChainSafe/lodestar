import {ContainerType, ITreeBacked, List, readOnlyMap, TreeBacked} from "@chainsafe/ssz";
import {allForks} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {MutableVector} from "@chainsafe/persistent-ts";
import {createFlat} from "./flat";
import {createEpochContext, EpochContext} from "./epochContext";
import {CachedValidatorList, CachedValidatorListProxyHandler} from "./cachedValidatorList";

/**
 * `BeaconState` with various caches
 *
 * Currently contains the following:
 * - The full list of network params, ssz types, and fork schedule
 * - The ssz type for the state
 * - The full merkle tree representation of the state
 * - A cache of shufflings, committees, proposers, expanded pubkeys
 * - A flat copy of validators (for fast access/iteration)
 */
export type CachedBeaconState<T extends allForks.BeaconState> =
  // Wrapper object ({validators, clone()})
  BeaconStateContext<T> &
    // Epoch Cache
    EpochContext &
    // SSZ ops
    ITreeBacked<T> &
    // Beacon State interface
    T;

export function createCachedBeaconState<T extends allForks.BeaconState>(
  config: IBeaconConfig,
  state: TreeBacked<T>
): CachedBeaconState<T> {
  const cachedValidators = MutableVector.from(readOnlyMap(state.validators, (v) => createFlat(v)));
  const epochCtx = createEpochContext(config, state, cachedValidators);
  return new Proxy(
    new BeaconStateContext(state, cachedValidators, epochCtx),
    (CachedBeaconStateProxyHandler as unknown) as ProxyHandler<BeaconStateContext<T>>
  ) as CachedBeaconState<T>;
}

export class BeaconStateContext<T extends allForks.BeaconState> {
  config: IBeaconConfig;
  // epoch cache
  epochCtx: EpochContext;
  // the BeaconState ssz type
  type: ContainerType<T>;
  // the original BeaconState as a Tree
  tree: Tree;
  // immutable and shared across BeaconStates for most of the validators
  protected _validatorCache: MutableVector<T["validators"][number]>;

  constructor(state: TreeBacked<T>, validatorCache: MutableVector<T["validators"][number]>, epochCtx: EpochContext) {
    this.config = epochCtx.config;
    this.type = state.type() as ContainerType<T>;
    this.tree = state.tree();
    this.epochCtx = epochCtx;
    this._validatorCache = validatorCache;
  }

  get validators(): CachedValidatorList<T["validators"][number]> & T["validators"] {
    return (new Proxy(
      new CachedValidatorList(
        (this.type.tree.getProperty(this.tree, "validators") as unknown) as TreeBacked<List<T["validators"][number]>>,
        this._validatorCache
      ),
      CachedValidatorListProxyHandler
    ) as unknown) as CachedValidatorList<T["validators"][number]> & T["validators"];
  }

  clone(): CachedBeaconState<T> {
    const state = this.type.tree.clone(this.tree);
    const validators = this._validatorCache.clone();
    return new Proxy(
      new BeaconStateContext(state, validators, this.epochCtx.copy()),
      (CachedBeaconStateProxyHandler as unknown) as ProxyHandler<BeaconStateContext<T>>
    ) as CachedBeaconState<T>;
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const CachedBeaconStateProxyHandler: ProxyHandler<CachedBeaconState<allForks.BeaconState>> = {
  get(target: CachedBeaconState<allForks.BeaconState>, key: string): unknown {
    if (key === "validators") {
      return target.validators;
    } else if (target.type.fields[key]) {
      return target.type.tree.getProperty(target.tree, key as keyof allForks.BeaconState);
    } else if (key in target.epochCtx) {
      return target.epochCtx[key as keyof EpochContext];
    } else if (key in target) {
      return target[key as keyof CachedBeaconState<allForks.BeaconState>];
    } else if (key in target.type.tree) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      return (target.type.tree as any)[key].bind(target.type.tree, target.tree);
    } else {
      return undefined;
    }
  },
  set(target: CachedBeaconState<allForks.BeaconState>, key: string, value: unknown): boolean {
    if (key === "validators") {
      throw new Error("Cannot set validators");
    } else if (target.type.fields[key]) {
      return target.type.tree.set(target.tree, key as keyof allForks.BeaconState, value);
    }
    return false;
  },
};
