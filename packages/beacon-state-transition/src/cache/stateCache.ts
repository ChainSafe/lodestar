import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {EpochContext, EpochContextImmutableData, EpochContextOpts} from "./epochContext.js";
import {BeaconStatePhase0, BeaconStateAltair, BeaconStateBellatrix, BeaconStateAllForks} from "./types.js";

export type BeaconStateCache = {
  config: IBeaconConfig;
  epochCtx: EpochContext;
};

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
 *
 * ------------------
 *
 * _Previous JSDocs for `BeaconStateContext`_
 *
 * Cache useful data associated to a specific state.
 * Optimize processing speed of block processing + gossip validation while having a low memory cost.
 *
 * Previously BeaconStateContext included:
 * ```ts
 * validators: CachedValidatorList & T["validators"];
 * balances: CachedBalanceList & T["balances"];
 * inactivityScores: CachedInactivityScoreList & Number64[];
 * ```
 *
 * Those caches where removed since they are no strictly necessary to make the epoch transition faster,
 * but have a high memory cost. Note that all data was duplicated between the Tree and MutableVector.
 * 1. TreeView, for efficient hashing
 * 2. MutableVector (persistent-ts) with StructBacked validator objects for fast accessing and iteration
 *
 * ### validators
 * state.validators is the heaviest data structure in the state. As TreeView, the leafs account for 91% with
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
 * ### epochParticipation
 * epochParticipation changes continuously through the epoch for each partipation bit of each valid attestation in the state.
 * The entire structure is dropped after two epochs.
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
export type CachedBeaconState<T extends BeaconStateAllForks> = T & BeaconStateCache;

export type CachedBeaconStatePhase0 = CachedBeaconState<BeaconStatePhase0>;
export type CachedBeaconStateAltair = CachedBeaconState<BeaconStateAltair>;
export type CachedBeaconStateBellatrix = CachedBeaconState<BeaconStateBellatrix>;
export type CachedBeaconStateAllForks = CachedBeaconState<BeaconStateAllForks>;

/**
 * Create CachedBeaconState computing a new EpochContext instance
 */
export function createCachedBeaconState<T extends BeaconStateAllForks>(
  state: T,
  immutableData: EpochContextImmutableData,
  opts?: EpochContextOpts
): T & BeaconStateCache {
  return getCachedBeaconState(state, {
    config: immutableData.config,
    epochCtx: EpochContext.createFromState(state, immutableData, opts),
  });
}

/**
 * Attach an already computed BeaconStateCache to a BeaconState object
 */
export function getCachedBeaconState<T extends BeaconStateAllForks>(
  state: T,
  cache: BeaconStateCache
): T & BeaconStateCache {
  const cachedState = state as T & BeaconStateCache;
  cachedState.config = cache.config;
  cachedState.epochCtx = cache.epochCtx;

  // Overwrite .clone function to preserve cache
  // TreeViewDU.clone() creates a new object that does not have the attached cache
  const viewDUClone = cachedState.clone.bind(cachedState);

  function clone(this: T & BeaconStateCache): T & BeaconStateCache {
    const viewDUCloned = viewDUClone();
    return getCachedBeaconState(viewDUCloned, {
      config: this.config,
      epochCtx: this.epochCtx.clone(),
    }) as T & BeaconStateCache;
  }

  cachedState.clone = clone as typeof viewDUClone;

  return cachedState;
}
