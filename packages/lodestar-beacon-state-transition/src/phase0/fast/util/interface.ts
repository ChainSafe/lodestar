import {ValidatorIndex, Slot, phase0} from "@chainsafe/lodestar-types";
import {ByteVector, readOnlyForEach} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {Vector} from "@chainsafe/persistent-ts";
import {IFlatValidator, createIFlatValidator} from "./flatValidator";
import {IReadonlyEpochShuffling} from ".";

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

  constructor(state: phase0.BeaconState, cachedValidators: Vector<IFlatValidator>) {
    this._state = state;
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

  /**
   * This is very cheap thanks to persistent-merkle-tree and persistent-vector.
   */
  public clone(): CachedValidatorsBeaconState {
    const clonedState = config.types.phase0.BeaconState.clone(this._state);
    const clonedCachedValidators = this._cachedValidators.clone();
    return new CachedValidatorsBeaconState(clonedState, clonedCachedValidators).createProxy();
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
  return new CachedValidatorsBeaconState(state, Vector.from(tmpValidators)).createProxy();
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
