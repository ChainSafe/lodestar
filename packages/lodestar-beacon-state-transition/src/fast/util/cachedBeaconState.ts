import {ValidatorIndex, BeaconState, Validator, Root} from "@chainsafe/lodestar-types";
import {isTreeBacked, readOnlyForEach, TreeBacked} from "@chainsafe/ssz";
import {createIFlatValidator, IFlatValidator} from "./flatValidator";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {Vector} from "@chainsafe/persistent-ts";
import {EpochContext} from "./epochContext";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

const BEACON_STATE_FIELDS = Object.keys(config.types.BeaconState.fields);
/**
 * This makes sure this class extends BeaconState interface.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface CachedBeaconState extends BeaconState {
  flatValidators(): Vector<IFlatValidator>;
  updateValidator(i: ValidatorIndex, value: Partial<IFlatValidator>): void;
  addValidator(validator: Validator): void;
  getOriginalState(): BeaconState;
  clone(): CachedBeaconState;
}

/**
 * Convenient class to be used for fast state transition with necessary cache.
 *   + Epoch cache stays in EpochContext.
 *   + BeaconState cache stays in this class.
 */
export class CachedBeaconState extends EpochContext {
  // the original BeaconState
  private _state: BeaconState;
  /**
   * Looping through validators inside TreeBacked<BeaconState> is so expensive.
   * Cache validators from TreeBacked<BeaconState> using a persistent vector for efficiency.
   * When write, write to both the cache and TreeBacked.
   * When read, just return the cache.
   */
  private _cachedValidators: Vector<IFlatValidator>;

  constructor(config: IBeaconConfig, state: BeaconState, cachedValidators: Vector<IFlatValidator>) {
    super(config);
    this._state = state;
    this._cachedValidators = cachedValidators;
  }

  public createProxy(): CachedBeaconState {
    return new Proxy(this, new CachedBeaconStateProxyHandler());
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
  public addValidator(validator: Validator): void {
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
  public clone(): CachedBeaconState {
    const cloned = new CachedBeaconState(
      this.config,
      this.config.types.BeaconState.clone(this._state),
      this._cachedValidators.clone()
    );
    // clone EpochContext
    super.copy(cloned);
    return cloned.createProxy();
  }

  /**
   * Same to EpochContext without param.
   */
  public rotateEpochs(): void {
    super.rotateEpochs(this);
  }

  /**
   * Same to EpochContext without param.
   */
  public syncPubkeys(): void {
    super.syncPubkeys(this.getOriginalState());
  }

  /**
   * Get the original state.
   */
  public getOriginalState(): BeaconState {
    return this._state;
  }

  /**
   * Same to getOriginalState but this makes sure it returns a TreeBacked<BeaconState>,
   * this is convenient for lodestar to consume.
   */
  public getTreeBackedState(): TreeBacked<BeaconState> {
    // this is usually the case as lodestar uses TreeBacked
    if (isTreeBacked(this._state)) {
      return this._state;
    }
    return this.config.types.BeaconState.tree.createValue(this._state);
  }

  /**
   * Calculate hash tree root.
   */
  public hashTreeRoot(): Root {
    return this.config.types.BeaconState.hashTreeRoot(this._state);
  }
}

/**
 * Convenient method to create a CachedBeaconState from a BeaconState
 * This is expensive and should only be called once.
 * @param state
 */
export function createCachedBeaconState(config: IBeaconConfig, state: BeaconState): CachedBeaconState {
  const tmpValidators: IFlatValidator[] = [];
  readOnlyForEach(state.validators, (validator) => {
    tmpValidators.push(createIFlatValidator(validator));
  });
  const cachedState = new CachedBeaconState(config, state, Vector.of(...tmpValidators));
  // cache EpochContext stuff
  cachedState.loadState(state);
  return cachedState.createProxy();
}

class CachedBeaconStateProxyHandler implements ProxyHandler<CachedBeaconState> {
  /**
   * Forward all BeaconState property getters to _state.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public get(target: CachedBeaconState, p: keyof BeaconState): any {
    if (BEACON_STATE_FIELDS.includes(p)) {
      return target.getOriginalState()[p];
    }
    return target[p];
  }

  /**
   * Forward all BeaconState property setters to _state.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public set(target: CachedBeaconState, p: keyof BeaconState, value: any): boolean {
    if (BEACON_STATE_FIELDS.includes(p)) {
      target.getOriginalState()[p] = value;
    } else {
      target[p] = value;
    }
    return true;
  }
}
