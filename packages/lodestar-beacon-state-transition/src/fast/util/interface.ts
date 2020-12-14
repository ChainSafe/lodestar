import {IReadonlyEpochShuffling} from ".";
import {ValidatorIndex, Slot, BeaconState, Validator} from "@chainsafe/lodestar-types";
import {List} from "immutable";
import {ByteVector, readOnlyForEach} from "@chainsafe/ssz";
import {createIFlatValidator, IFlatValidator} from "./flatValidator";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";

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
 * Instead of accesing `validators` array directly inside BeaconState, use:
 * + flatValidators() for the loop
 * + setValidator() for an update
 * + addValidator() for a creation
 * that'd update both the cached validators array and the one in the original state.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface CachedValidatorsBeaconState extends BeaconState {
  flatValidators(): List<IFlatValidator>;
  setValidator(i: ValidatorIndex, value: Partial<IFlatValidator>): void;
  addValidator(validator: Validator): void;
  getOriginalState(): BeaconState;
  clone(): CachedValidatorsBeaconState;
}

/**
 * Looping through validators inside TreeBacked<BeaconState> is so expensive.
 * Cache validators from TreeBacked<BeaconState>.
 * When write, write to both the cache and TreeBacked.
 * When read, just return the cache.
 */
export class CachedValidatorsBeaconState {
  public _state: BeaconState;
  private _cachedValidators: List<IFlatValidator>;

  constructor(state: BeaconState, cachedValidators: List<IFlatValidator>) {
    this._state = state;
    this._cachedValidators = cachedValidators;
  }

  public createProxy(): CachedValidatorsBeaconState {
    return new Proxy(this, new CachedValidatorsBeaconStateProxyHandler());
  }

  /**
   * Write to both the cached validator and BeaconState
   */
  public setValidator(i: ValidatorIndex, value: Partial<IFlatValidator>): void {
    if (this._cachedValidators) {
      const validator = this._cachedValidators.get(i)!;
      this._cachedValidators = this._cachedValidators.set(i, {...validator, ...value});
    }
    const validator = this._state.validators[i];
    if (value.activationEligibilityEpoch !== undefined)
      validator.activationEligibilityEpoch = value.activationEligibilityEpoch;
    if (value.activationEpoch !== undefined) validator.activationEpoch = value.activationEpoch;
    if (value.effectiveBalance !== undefined) validator.effectiveBalance = value.effectiveBalance;
    if (value.exitEpoch !== undefined) validator.exitEpoch = value.exitEpoch;
    if (value.slashed !== undefined) validator.slashed = value.slashed;
    if (value.withdrawableEpoch !== undefined) validator.withdrawableEpoch = value.withdrawableEpoch;
  }

  /**
   * Add validator to both the cache and BeaconState
   */
  public addValidator(validator: Validator): void {
    this._cachedValidators = this._cachedValidators.push(createIFlatValidator(validator));
    this._state.validators.push(validator);
  }

  /**
   * Loop through the cached validators, not the TreeBacked validators inside BeaconState.
   */
  public flatValidators(): List<IFlatValidator> {
    return this._cachedValidators;
  }

  public clone(): CachedValidatorsBeaconState {
    const clonedState = config.types.BeaconState.clone(this._state);
    return cloneCachedValidatorsBeaconState(clonedState, this._cachedValidators);
  }

  public getOriginalState(): BeaconState {
    return this._state;
  }

}

export function createCachedValidatorsBeaconState(state: BeaconState): CachedValidatorsBeaconState {
  const tmpValidators: IFlatValidator[] = [];
  readOnlyForEach(state.validators, (validator) => {
    tmpValidators.push(createIFlatValidator(validator));
  });
  return new CachedValidatorsBeaconState(state, List(tmpValidators)).createProxy();
}

function cloneCachedValidatorsBeaconState(
  state: BeaconState,
  cachedValidators: List<IFlatValidator>
): CachedValidatorsBeaconState {
  return new CachedValidatorsBeaconState(state, cachedValidators).createProxy();
}

class CachedValidatorsBeaconStateProxyHandler implements ProxyHandler<CachedValidatorsBeaconState> {
  /**
   * Forward all BeaconState property getters to _state.
   * StateTransitionBeaconState should handle validators, setValidator
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public get(target: CachedValidatorsBeaconState, p: keyof BeaconState): any {
    if (target[p] !== undefined) {
      return target[p];
    }
    return target._state[p];
  }

  /**
   * Forward all BeaconState property setters to _state.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public set(target: CachedValidatorsBeaconState, p: keyof BeaconState, value: any): boolean {
    if (target[p] !== undefined) {
      target[p] = value;
    } else {
      target._state[p] = value;
    }
    return true;
  }
}
