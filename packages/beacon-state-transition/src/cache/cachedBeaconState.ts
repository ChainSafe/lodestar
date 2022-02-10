import {
  BasicListType,
  CompositeValue,
  ContainerType,
  isCompositeType,
  isTreeBacked,
  ITreeBacked,
  List,
  Number64ListType,
  readonlyValues,
  TreeBacked,
} from "@chainsafe/ssz";
import {allForks, altair, Number64, ParticipationFlags} from "@chainsafe/lodestar-types";
import {createIBeaconConfig, IBeaconConfig, IChainForkConfig} from "@chainsafe/lodestar-config";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {MutableVector} from "@chainsafe/persistent-ts";
import {EpochContext, EpochContextOpts} from "./epochContext";
import {BalanceList} from "./balanceList";
import {CachedEpochParticipation, CachedEpochParticipationProxyHandler} from "./cachedEpochParticipation";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedInactivityScoreList, CachedInactivityScoreListProxyHandler} from "./cachedInactivityScoreList";
import {newFilledArray} from "../util/array";

/**
 * `BeaconState` with various caches
 *
 * Currently contains the following:
 * - The full list of network params, ssz types, and fork schedule
 * - The ssz type for the state
 * - The full merkle tree representation of the state
 * - A cache of shufflings, committees, proposers, expanded pubkeys
 * - A flat copy of validators (for fast access/iteration)
 *
 * ### BeaconState data representation tradeoffs:
 *
 * Requirements of a BeaconState:
 * - Block processing and epoch processing be performant to not block the node. This functions requires to iterate over
 *   very large arrays fast, while doing random mutations or big mutations. After them the state must be hashed.
 *   Processing times: (ideal / current / maximum)
 *   - block processing: 20ms / 200ms / 500ms
 *   - epoch processing: 200ms / 2s / 4s
 *
 * - BeaconState must be memory efficient. Data should only be represented once in a succint manner. Uint8Arrays are
 *   expensive, native types are not.
 * - BeaconState must be hashed efficiently. Data must be merkelized before hashing so the conversion to merkelized
 *   must be fast or be done already. It must must persist a hashing cache that should be structurally shared between
 *   states for memory efficiency.
 * - BeaconState raw data changes sparsingly, so it should be structurally shared between states for memory efficiency
 *
 * Summary of goals:
 * - Structurally share data + hashing cache
 * - Very fast read and iteration over large arrays
 * - Fast bulk writes and somewhat fast single writes
 * - Fast merkelization of data for hashing
 *
 * #### state.validators
 *
 * 91% of all memory merkelized is state.validators. In normal network conditions state.validators changes rarely.
 * However for epoch processing the entire array must be iterated and read. So we need fast reads and slow writes.
 * Tradeoffs to achieve that:
 * - Represent leaf data with native JS types (deserialized form)
 * - Use a single Tree for structurally sharing leaf data + hashing cache
 * - Keep only the root cached on leaf nodes
 * - Micro-optimizations (TODO):
 *   - Keep also the root of the node above pubkey and withdrawal creds. Will never change
 *   - Keep pubkey + withdrawal creds in the same Uint8Array
 *   - Have a global pubkey + withdrawal creds Uint8Array global cache, like with the index2pubkey cache
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
  chainForkConfig: IChainForkConfig,
  state: TreeBacked<T>,
  opts?: EpochContextOpts
): CachedBeaconState<T> {
  const config = createIBeaconConfig(chainForkConfig, state.genesisValidatorsRoot);

  let cachedPreviousParticipation, cachedCurrentParticipation;
  const forkName = config.getForkName(state.slot);
  const epochCtx = EpochContext.createFromState(config, state, opts);
  let cachedInactivityScores: MutableVector<Number64>;
  if (forkName === ForkName.phase0) {
    // TODO: More efficient way of getting the length?
    const validatorCount = state.validators.length;
    // Can these arrays be zero-ed for phase0? Are they actually used?
    cachedPreviousParticipation = MutableVector.from(newFilledArray(validatorCount, 0));
    cachedCurrentParticipation = MutableVector.from(newFilledArray(validatorCount, 0));
    cachedInactivityScores = MutableVector.empty();
  } else {
    const altairState = (state as unknown) as TreeBacked<altair.BeaconState>;
    cachedPreviousParticipation = MutableVector.from(
      Array.from(readonlyValues(altairState.previousEpochParticipation))
    );
    cachedCurrentParticipation = MutableVector.from(Array.from(readonlyValues(altairState.currentEpochParticipation)));
    cachedInactivityScores = MutableVector.from(readonlyValues(altairState.inactivityScores));
  }
  return new Proxy(
    new BeaconStateContext(
      state.type as ContainerType<T>,
      state.tree,
      cachedPreviousParticipation,
      cachedCurrentParticipation,
      cachedInactivityScores,
      epochCtx
    ),
    (CachedBeaconStateProxyHandler as unknown) as ProxyHandler<BeaconStateContext<T>>
  ) as CachedBeaconState<T>;
}

/**
 * Cache useful data associated to a specific state.
 * Optimize processing speed of block processing + gossip validation while having a low memory cost.
 *
 * Previously BeaconStateContext included:
 * ```ts
 * validators: CachedValidatorList & T["validators"];
 * balances: CachedBalanceList & T["balances"];
 * inactivityScores: CachedInactivityScoreList & List<Number64>;
 * ```
 *
 * Those caches where removed since they are no strictly necessary to make the epoch transition faster,
 * but have a high memory cost. Note that all data was duplicated between the Tree and MutableVector.
 * 1. TreeBacked, for efficient hashing
 * 2. MutableVector (persistent-ts) with StructBacked validator objects for fast accessing and iteration
 *
 * ### validators
 * state.validators is the heaviest data structure in the state. As TreeBacked, the leafs account for 91% with
 * 200_000 validators. It requires ~ 2_000_000 Uint8Array instances with total memory of ~ 400MB.
 * However its contents don't change very often. Validators only change when;
 * - they first deposit
 * - they dip from 32 effective balance to 31 (pretty much only when inactive for very long, or slashed)
 * - they activate (once)
 * - they exit (once)
 * - they get slashed (max once)
 *
 * ### balances
 * The balances array completely changes at the epoch boundary, where almost all the validator balances
 * are updated. However it may have tiny changes during block processing if:
 * - On a valid deposit
 * - Validator gets slashed
 * - On altair, the block proposer. Optimized to only happen once per block
 *
 * ### inactivityScores
 * inactivityScores can be changed only:
 * - At the epoch transition. It only changes when a validator is offline. So it may change a bit but not
 *   a lot on normal network conditions.
 * - During block processing, when a validator joins a new 0 entry is pushed
 *
 * RESULT: Don't keep a duplicated structure around always. During block processing just push to the tree. During
 * epoch processing some temporary flat structures are computed but dropped after processing the epoch.
 */
export class BeaconStateContext<T extends allForks.BeaconState> {
  config: IBeaconConfig;
  /**
   * Epoch cache: Caches constant data through the epoch: @see EpochContext
   * - Proposer indexes: 32 x Number
   * - Shufflings: 3 x $VALIDATOR_COUNT x Number
   */
  epochCtx: EpochContext;
  /** The BeaconState ssz type */
  type: ContainerType<T>;
  /** The original BeaconState as a Tree */
  tree: Tree;
  /**
   * Returns a BalanceList instance with some convenient methods to work with Tree more efficiently.
   * Notice that we want to work with state.balanceList instead of state.balances.
   *
   * The balances array completely changes at the epoch boundary, where almost all the validator balances
   * are updated. However it may have tiny changes during block processing if:
   * - On a valid deposit
   * - Validator gets slashed?
   * - On altair, the block proposer
   *
   */
  balanceList: BalanceList;
  /**
   * Returns a Proxy to CachedEpochParticipation
   *
   * Stores state<altair>.previousEpochParticipation in two duplicated forms (both structures are structurally shared):
   * 1. TreeBacked, for efficient hashing
   * 2. MutableVector (persistent-ts) with each validator participation flags (uint8) in object form
   *
   * epochParticipation changes continuously through the epoch for each partipation bit of each valid attestation in the state.
   * The entire structure is dropped after two epochs.
   *
   * TODO: Consider representing participation as a uint8 always, and have a fast transformation fuction with precomputed values.
   * Here using a Uint8Array is probably the most efficient way of representing this structure. Then we only need a way to get
   * and set the values fast to the tree. Maybe batching?
   */
  previousEpochParticipation: CachedEpochParticipation & List<ParticipationFlags>;
  /** Same as previousEpochParticipation */
  currentEpochParticipation: CachedEpochParticipation & List<ParticipationFlags>;
  /**
   * Returns a Proxy to CachedInactivityScoreList
   *
   * Stores state<altair>.inactivityScores in two duplicated forms (both structures are structurally shared):
   * 1. TreeBacked, for efficient hashing
   * 2. MutableVector (persistent-ts) with a uint64 for each validator
   *
   * inactivityScores can be changed only:
   * - At the epoch transition. It only changes when a validator is offline. So it may change a bit but not
   *   a lot on normal network conditions.
   * - During block processing, when a validator joins a new 0 entry is pushed
   *
   * TODO: Don't keep a duplicated structure around always. During block processing just push to the tree,
   * and maybe batch the changes. Then on process_inactivity_updates() compute the total deltas, and depending
   * on the number of changes convert tree to array, apply diff, write to tree again. Or if there are just a few
   * changes update the tree directly.
   */
  inactivityScores: CachedInactivityScoreList & List<Number64>;

  constructor(
    type: ContainerType<T>,
    tree: Tree,
    previousEpochParticipationCache: MutableVector<ParticipationFlags>,
    currentEpochParticipationCache: MutableVector<ParticipationFlags>,
    inactivityScoresCache: MutableVector<Number64>,
    epochCtx: EpochContext
  ) {
    this.config = epochCtx.config;
    this.type = type;
    this.tree = tree;
    this.epochCtx = epochCtx;
    this.balanceList = new BalanceList(
      this.type.fields["balances"] as Number64ListType,
      this.type.tree_getProperty(this.tree, "balances") as Tree
    );
    this.previousEpochParticipation = (new Proxy(
      new CachedEpochParticipation({
        type: this.type.fields["previousEpochParticipation"] as BasicListType<List<ParticipationFlags>>,
        tree: this.type.tree_getProperty(this.tree, "previousEpochParticipation") as Tree,
        persistent: previousEpochParticipationCache,
      }),
      CachedEpochParticipationProxyHandler
    ) as unknown) as CachedEpochParticipation & List<ParticipationFlags>;
    this.currentEpochParticipation = (new Proxy(
      new CachedEpochParticipation({
        type: this.type.fields["currentEpochParticipation"] as BasicListType<List<ParticipationFlags>>,
        tree: this.type.tree_getProperty(this.tree, "currentEpochParticipation") as Tree,
        persistent: currentEpochParticipationCache,
      }),
      CachedEpochParticipationProxyHandler
    ) as unknown) as CachedEpochParticipation & List<ParticipationFlags>;
    this.inactivityScores = (new Proxy(
      new CachedInactivityScoreList(
        this.type.fields["inactivityScores"] as BasicListType<List<Number64>>,
        this.type.tree_getProperty(this.tree, "inactivityScores") as Tree,
        inactivityScoresCache
      ),
      CachedInactivityScoreListProxyHandler
    ) as unknown) as CachedInactivityScoreList & List<Number64>;
  }

  clone(): CachedBeaconState<T> {
    return new Proxy(
      new BeaconStateContext(
        this.type,
        this.tree.clone(),
        this.previousEpochParticipation.persistent.clone(),
        this.currentEpochParticipation.persistent.clone(),
        this.inactivityScores.persistent.clone(),
        this.epochCtx.copy()
      ),
      (CachedBeaconStateProxyHandler as unknown) as ProxyHandler<BeaconStateContext<T>>
    ) as CachedBeaconState<T>;
  }

  /**
   * Toggle all `MutableVector` caches to use `TransientVector`
   */
  setStateCachesAsTransient(): void {
    this.previousEpochParticipation.persistent.asTransient();
    this.currentEpochParticipation.persistent.asTransient();
    this.inactivityScores.persistent.asTransient();
  }

  /**
   * Toggle all `MutableVector` caches to use `PersistentVector`
   */
  setStateCachesAsPersistent(): void {
    this.previousEpochParticipation.persistent.asPersistent();
    this.currentEpochParticipation.persistent.asPersistent();
    this.inactivityScores.persistent.asPersistent();
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const CachedBeaconStateProxyHandler: ProxyHandler<CachedBeaconState<allForks.BeaconState>> = {
  get(target: CachedBeaconState<allForks.BeaconState>, key: string): unknown {
    if (key === "balanceList") {
      return target.balanceList;
    } else if (key === "previousEpochParticipation") {
      return target.previousEpochParticipation;
    } else if (key === "currentEpochParticipation") {
      return target.currentEpochParticipation;
    } else if (key === "inactivityScores") {
      return target.inactivityScores;
    } else if (target.type.fields[key] !== undefined) {
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
    } else if (key === "balanceList" || key === "balances") {
      throw new Error("Cannot set either balanceList or balances");
    } else if (key === "previousEpochParticipation") {
      throw new Error("Cannot set previousEpochParticipation");
    } else if (key === "currentEpochParticipation") {
      throw new Error("Cannot set currentEpochParticipation");
    } else if (key === "inactivityScores") {
      throw new Error("Cannot set inactivityScores");
    } else if (target.type.fields[key] !== undefined) {
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
