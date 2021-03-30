import {
  CompositeListType,
  CompositeValue,
  ContainerType,
  isCompositeType,
  isTreeBacked,
  ITreeBacked,
  List,
  TreeBacked,
} from "@chainsafe/ssz";
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
  const cachedValidators = MutableVector.from(Array.from(state.validators, (v) => createFlat(v)));
  const epochCtx = createEpochContext(config, state, cachedValidators);
  return new Proxy(
    new BeaconStateContext(state.type as ContainerType<T>, state.tree, cachedValidators, epochCtx),
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

  constructor(
    type: ContainerType<T>,
    tree: Tree,
    validatorCache: MutableVector<T["validators"][number]>,
    epochCtx: EpochContext
  ) {
    this.config = epochCtx.config;
    this.type = type;
    this.tree = tree;
    this.epochCtx = epochCtx;
    this._validatorCache = validatorCache;
  }

  get validators(): CachedValidatorList<T["validators"][number]> & T["validators"] {
    return (new Proxy(
      new CachedValidatorList(
        this.type.fields["validators"] as CompositeListType<List<T["validators"][number]>>,
        this.type.tree_getProperty(this.tree, "validators") as Tree,
        this._validatorCache
      ),
      CachedValidatorListProxyHandler
    ) as unknown) as CachedValidatorList<T["validators"][number]> & T["validators"];
  }

  clone(): CachedBeaconState<T> {
    return new Proxy(
      new BeaconStateContext(this.type, this.tree.clone(), this._validatorCache.clone(), this.epochCtx.copy()),
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
      const propType = target.type.fields[key];
      const propValue = target.type.tree_getProperty(target.tree, key);
      if (!isCompositeType(propType)) {
        return propValue;
      } else {
        return propType.createTreeBacked(propValue as Tree);
      }
    } else if (key in target.epochCtx) {
      return target.epochCtx[key as keyof EpochContext];
    } else if (key in target) {
      return target[key as keyof CachedBeaconState<allForks.BeaconState>];
    } else {
      const treeBacked = target.type.createTreeBacked(target.tree);
      if (key in treeBacked) {
        return treeBacked[key as keyof TreeBacked<allForks.BeaconState>];
      }
    }
    return undefined;
  },
  set(target: CachedBeaconState<allForks.BeaconState>, key: string, value: unknown): boolean {
    if (key === "validators") {
      throw new Error("Cannot set validators");
    } else if (target.type.fields[key]) {
      const propType = target.type.fields[key];
      if (!isCompositeType(propType)) {
        return target.type.tree_setProperty(target.tree, key, value);
      } else {
        if (isTreeBacked(value)) {
          return target.type.tree_setProperty(target.tree, key, value.tree);
        } else {
          return target.type.tree_setProperty(
            target.tree,
            key,
            propType.struct_convertToTree((value as unknown) as CompositeValue)
          );
        }
      }
    }
    return false;
  },
};
