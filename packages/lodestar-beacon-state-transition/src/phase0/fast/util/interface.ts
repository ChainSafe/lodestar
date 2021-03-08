import {ValidatorIndex, Slot, phase0} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {BasicListType, BigIntUintType, ByteVector, NumberUintType, readOnlyForEach, TreeBacked} from "@chainsafe/ssz";
import {Tree, Node, countToDepth, LeafNode, subtreeFillToContents} from "@chainsafe/persistent-merkle-tree";
import {Vector} from "@chainsafe/persistent-ts";
import {IFlatValidator, createIFlatValidator} from "./flatValidator";
import {IReadonlyEpochShuffling} from ".";
import {BeaconState} from "@chainsafe/lodestar-types/lib/phase0/types";
import {
  assert,
  calculateBigIntUint8Array,
  increaseUint8Array,
  addUint8Array,
  decreaseUint8ArrayGte0,
  subtractUint8ArrayGte0,
} from "@chainsafe/lodestar-utils";

const balancesBytes8Type = new BasicListType({
  elementType: config.types.Bytes8,
  limit: config.params.VALIDATOR_REGISTRY_LIMIT,
});

const balanceBigIntType = new BigIntUintType({byteLength: 8});

const BALANCES_FIELD_IN_BEACON_STATE = 12;

/**
 * Readonly interface for EpochContext.
 */
export type ReadonlyEpochContext = {
  readonly pubkey2index: ReadonlyMap<ByteVector, ValidatorIndex>;
  readonly index2pubkey: Readonly<Uint8Array[]>;
  readonly currentShuffling?: IReadonlyEpochShuffling;
  readonly previousShuffling?: IReadonlyEpochShuffling;
  getBeaconProposer: (slot: Slot) => ValidatorIndex;
};

/**
 * Cache validators of state using a persistent vector to improve the loop performance.
 * Instead of accessing `validators` array directly inside BeaconState, use:
 * + flatValidators() for the loop
 * + updateValidator() for an update
 * + addValidator() for a creation
 * that'd update both the cached validators and the one in the original state.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface CachedValidatorsBeaconState extends phase0.BeaconState {
  flatValidators(): Vector<IFlatValidator>;
  updateValidator(i: ValidatorIndex, value: Partial<IFlatValidator>): void;
  addValidator(validator: phase0.Validator): void;
  getOriginalState(): phase0.BeaconState;
  clone(): CachedValidatorsBeaconState;
}

/**
 * Looping through validators inside TreeBacked<BeaconState> is so expensive.
 * Cache validators from TreeBacked<BeaconState> using a persistent vector for efficiency.
 * When write, write to both the cache and TreeBacked.
 * When read, just return the cache.
 */
export class CachedValidatorsBeaconState {
  // the original BeaconState
  private _state: phase0.BeaconState;
  // this is immutable and shared across BeaconStates for most of the validators
  private _cachedValidators: Vector<IFlatValidator>;
  // this is shared between persistent-merkle-tree and persistent-ts
  // 1 chunk = 4 balances in type of Uint8Array(8) => it's a Uint8Array(32)
  private _balanceChunks: Vector<Uint8Array>;
  // the leaves of this tree is actually data of _balanceChunks
  private _balancesTree: Tree;

  constructor(
    state: phase0.BeaconState,
    balanceChunks: Vector<Uint8Array>,
    balancesTree: Tree,
    cachedValidators: Vector<IFlatValidator>
  ) {
    this._state = state;
    this._balanceChunks = balanceChunks;
    this._balancesTree = balancesTree;
    this._cachedValidators = cachedValidators;
  }

  public createProxy(): CachedValidatorsBeaconState {
    return new Proxy(this, new CachedValidatorsBeaconStateProxyHandler());
  }

  /**
   * Write to both the cached validator and BeaconState.
   * _cachedValidators refers to a new instance
   */
  public updateValidator(i: ValidatorIndex, value: Partial<IFlatValidator>): void {
    if (this._cachedValidators) {
      const validator = this._cachedValidators.get(i);
      this._cachedValidators = this._cachedValidators.set(i, {...validator!, ...value});
    }
    const validator = this._state.validators[i];
    Object.assign(validator, value);
  }

  /**
   * Add validator to both the cache and BeaconState
   * _cachedValidators refers to a new instance
   */
  public addValidator(validator: phase0.Validator): void {
    this._cachedValidators = this._cachedValidators.append(createIFlatValidator(validator));
    this._state.validators.push(validator);
  }

  /**
   * Loop through the cached validators, not the TreeBacked validators inside BeaconState.
   */
  public flatValidators(): Vector<IFlatValidator> {
    return this._cachedValidators;
  }

  public getBalance(validatorIndex: number): bigint {
    const chunkIndex = getChunkIndex(validatorIndex);
    const offset = getOffset(validatorIndex);
    return balanceBigIntType.fromBytes(this._balanceChunks.get(chunkIndex)!, offset);
  }

  /**
   * Process epoch (rewards + penalties)
   * Rebuild the balances tree
   */
  public updateBalances(rewards: number[], penalties: number[]): void {
    assert.equal(rewards.length, penalties.length, "rewards and penalties should have same length");
    assert.equal(
      rewards.length,
      this._state.balances.length,
      "rewards and balances should have same length to balance's"
    );
    let deltas: number[] = [];
    let newBalanceChunks = Vector.empty<Uint8Array>();
    for (let validatorIndex = 0; validatorIndex < rewards.length; validatorIndex++) {
      if (validatorIndex % 4 === 0) {
        deltas = [];
      }
      const delta = rewards[validatorIndex] - penalties[validatorIndex];
      deltas.push(delta);
      if (validatorIndex % 4 === 3 || validatorIndex === rewards.length - 1) {
        while (deltas.length < 4) deltas.push(0);
        const chunkIndex = getChunkIndex(validatorIndex);
        newBalanceChunks = newBalanceChunks.append(
          calculateBigIntUint8Array(this._balanceChunks.get(chunkIndex)!, deltas)
        );
      }
    }
    this._balanceChunks = newBalanceChunks;
    // build the whole tree again
    this._balancesTree = buildBalancesTree(
      this._balanceChunks,
      this._state.balances.length,
      config.params.VALIDATOR_REGISTRY_LIMIT
    );
    const beaconStateTree = (this._state as TreeBacked<BeaconState>).tree();
    config.types.phase0.BeaconState.tree.setSubtreeAtChunk(
      beaconStateTree,
      BALANCES_FIELD_IN_BEACON_STATE,
      this._balancesTree
    );
  }

  /**
   * Process block, update both the tree and _balances
   */
  public increaseBalance(validatorIndex: number, delta: number): void {
    assert.gte(delta, 0, "delta in increaseBalance should be >= 0");
    const chunkIndex = getChunkIndex(validatorIndex);
    const newChunk = new Uint8Array(32);
    newChunk.set(this._balanceChunks.get(chunkIndex)!);
    const offset = getOffset(validatorIndex);
    // mutate newChunk
    increaseUint8Array(newChunk, delta, offset);
    this._balanceChunks = this._balanceChunks.set(chunkIndex, newChunk);
    balancesBytes8Type.tree.setRootAtChunk(this._balancesTree, chunkIndex, newChunk);
  }

  /**
   * Process block, update both the tree and _balances
   */
  public increaseBalanceBigInt(validatorIndex: number, amount: bigint): void {
    assert.true(amount > 0, "amount in increaseBalance should be >= 0");
    const amountUint8Array = new Uint8Array(8);
    balanceBigIntType.toBytes(amount, amountUint8Array, 0);
    const chunkIndex = getChunkIndex(validatorIndex);
    const offset = getOffset(validatorIndex);
    const newChunk = addUint8Array(this._balanceChunks.get(chunkIndex)!, amountUint8Array, offset);
    this._balanceChunks = this._balanceChunks.set(chunkIndex, newChunk);
    balancesBytes8Type.tree.setRootAtChunk(this._balancesTree, chunkIndex, newChunk);
  }

  /**
   * Process block, update both the tree and _balances
   */
  public decreaseBalance(validatorIndex: number, delta: number): void {
    assert.gte(delta, 0, "delta in decreaseBalance should be >= 0");
    const chunkIndex = getChunkIndex(validatorIndex);
    const newChunk = new Uint8Array(32);
    newChunk.set(this._balanceChunks.get(chunkIndex)!);
    const offset = getOffset(validatorIndex);
    // mutate newChunk
    decreaseUint8ArrayGte0(newChunk, delta, offset);
    this._balanceChunks = this._balanceChunks.set(chunkIndex, newChunk);
    balancesBytes8Type.tree.setRootAtChunk(this._balancesTree, chunkIndex, newChunk);
  }

  /**
   * Process block, update both the tree and _balances
   */
  public decreaseBalanceBigInt(validatorIndex: number, delta: bigint): void {
    assert.true(delta >= 0, "delta in decreaseBalance should be >= 0");
    const deltaUint8Array = new Uint8Array(8);
    balanceBigIntType.toBytes(delta, deltaUint8Array, 0);
    const chunkIndex = getChunkIndex(validatorIndex);
    const offset = getOffset(validatorIndex);
    const newChunk = subtractUint8ArrayGte0(this._balanceChunks.get(chunkIndex)!, deltaUint8Array, offset);
    this._balanceChunks = this._balanceChunks.set(chunkIndex, newChunk);
    balancesBytes8Type.tree.setRootAtChunk(this._balancesTree, chunkIndex, newChunk);
  }

  public addBalance(amount: bigint): void {
    const amountArr = new Uint8Array(8);
    balanceBigIntType.toBytes(amount, amountArr, 0);
    const numBalance = this._state.balances.length;
    if (numBalance % 4 === 0) {
      const newChunk = new Uint8Array(32);
      newChunk.set(amountArr);
      this._balanceChunks = this._balanceChunks.append(newChunk);
      balancesBytes8Type.tree.setRootAtChunk(this._balancesTree, this._balanceChunks.length - 1, newChunk);
    } else {
      const offset = getOffset(numBalance);
      const lastChunkIndex = this._balanceChunks.length - 1;
      const newChunk = addUint8Array(this._balanceChunks.get(lastChunkIndex)!, amountArr, offset);
      this._balanceChunks = this._balanceChunks.set(lastChunkIndex, newChunk);
      balancesBytes8Type.tree.setRootAtChunk(this._balancesTree, lastChunkIndex, newChunk);
    }
    setTreeLength(this._balancesTree, numBalance);
  }

  /**
   * This is very cheap thanks to persistent-merkle-tree and persistent-vector.
   */
  public clone(): CachedValidatorsBeaconState {
    const clonedState = config.types.phase0.BeaconState.clone(this._state);
    const clonedCachedValidators = this._cachedValidators.clone();
    const balanceTree = this._balancesTree.clone();
    const balanceChunks = this._balanceChunks.clone();
    return new CachedValidatorsBeaconState(
      clonedState,
      balanceChunks,
      balanceTree,
      clonedCachedValidators
    ).createProxy();
  }

  public getOriginalState(): phase0.BeaconState {
    return this._state;
  }
}

/**
 * Convenient method to create a CachedValidatorsBeaconState from a BeaconState
 * @param state
 */
export function createCachedValidatorsBeaconState(state: phase0.BeaconState): CachedValidatorsBeaconState {
  const tmpValidators: IFlatValidator[] = [];
  readOnlyForEach(state.validators, (validator) => {
    tmpValidators.push(createIFlatValidator(validator));
  });
  const beaconStateTree = (state as TreeBacked<BeaconState>).tree();
  const balanceTree = config.types.phase0.BeaconState.tree.getSubtreeAtChunk(
    beaconStateTree,
    BALANCES_FIELD_IN_BEACON_STATE
  );
  let balanceChunks: Vector<Uint8Array> = Vector.empty<Uint8Array>();
  const lastChunkIndex = getChunkIndex(state.balances.length - 1);
  for (let chunkIndex = 0; chunkIndex <= lastChunkIndex; chunkIndex++) {
    balanceChunks = balanceChunks.append(balancesBytes8Type.tree.getRootAtChunk(balanceTree, chunkIndex));
  }

  return new CachedValidatorsBeaconState(state, balanceChunks, balanceTree, Vector.from(tmpValidators)).createProxy();
}

/**
 * Build tree with tree leaves sharing same data with balanceChunks
 * @param balanceChunks each item is 32 byte representing 4 balances
 * @param length number of validators, is not always balanceChunks * 4
 * @param limit from the config
 */
export function buildBalancesTree(balanceChunks: Vector<Uint8Array>, length: number, limit: number): Tree {
  const contents: Node[] = balanceChunks.readOnlyMap((chunk) => new LeafNode(chunk));
  const tree = new Tree(subtreeFillToContents(contents, getDepth(limit)));
  setTreeLength(tree, length);
  return tree;
}

function getDepth(limit: number): number {
  const maxChunkCount = Math.ceil((limit * 8) / 32);
  return countToDepth(BigInt(maxChunkCount)) + 1;
}

function setTreeLength(target: Tree, length: number): void {
  const number32Type = new NumberUintType({byteLength: 4});
  const chunk = new Uint8Array(32);
  number32Type.toBytes(length, chunk, 0);
  target.setRoot(BigInt(3), chunk);
}

function getChunkIndex(validatorIndex: number): number {
  return Math.floor(validatorIndex / 4);
}

function getOffset(validatorIndex: number): number {
  return (validatorIndex % 4) * 8;
}

class CachedValidatorsBeaconStateProxyHandler implements ProxyHandler<CachedValidatorsBeaconState> {
  /**
   * Forward all BeaconState property getters to _state.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public get(target: CachedValidatorsBeaconState, p: keyof phase0.BeaconState): any {
    if (target[p] !== undefined) {
      return target[p];
    }
    return target.getOriginalState()[p];
  }

  /**
   * Forward all BeaconState property setters to _state.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public set(target: CachedValidatorsBeaconState, p: keyof phase0.BeaconState, value: any): boolean {
    if (target[p] !== undefined) {
      target[p] = value;
    } else {
      target.getOriginalState()[p] = value;
    }
    return true;
  }
}
