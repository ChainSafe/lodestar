import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, ValidatorIndex, Root, FinalityCheckpoints, ValidatorBalance} from "@chainsafe/lodestar-types";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {IBeaconDb} from "../../../../db/api";
import {IApiOptions} from "../../../options";
import {IApiModules} from "../../interface";
import {IBeaconStateApi, StateId, IValidatorFilters} from "./interface";
import {resolveStateId} from "./utils";
import {MissingState} from "./errors";
import {ValidatorResponse} from "../../../types/validator";
import * as validatorStatusUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/validatorStatus";
import {ValidatorIndex} from "@chainsafe/lodestar-types/src/ssz/generators/primitive";

export class BeaconStateApi implements IBeaconStateApi {
  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly forkChoice: IForkChoice;

  public constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config" | "db" | "chain">) {
    this.config = modules.config;
    this.db = modules.db;
    this.forkChoice = modules.chain.forkChoice;
  }

  public async getStateRoot(stateId: StateId): Promise<Root | null> {
    const state = await this.getState(stateId);
    if (!state) {
      return null;
    }
    return this.config.types.BeaconState.hashTreeRoot(state);
  }
  public async getStateFinalityCheckpoints(stateId: StateId): Promise<FinalityCheckpoints | null> {
    const state = await this.getState(stateId);
    if (!state) {
      return null;
    }
    return {
      currentJustified: state.currentJustifiedCheckpoint,
      previousJustified: state.previousJustifiedCheckpoint,
      finalized: state.finalizedCheckpoint,
    };
  }
  public async getStateValidators(stateId: StateId, filters?: IValidatorFilters): Promise<ValidatorResponse[]> {
    const state = await this.getState(stateId);
    if (!state) {
      throw new MissingState();
    }
    let validators = state.validators;
    if (filters?.indices) {
      validators = filters.indices.map((index) => {
        if (typeof index === "number") {
          return validators[index];
        } else {
          //index is pubkey
          return validators.find(validator => {
            return this.config.types.equals("")
          })
        }
      });
    }

    return;
  }

  public async getStateValidator(
    stateId: StateId,
    validatorId: ValidatorIndex | Root
  ): Promise<ValidatorResponse | null> {
    throw new Error("Method not implemented.");
  }
  public async getStateValidatorBalances(
    stateId: StateId,
    indices?: (ValidatorIndex | Root)[]
  ): Promise<ValidatorBalance[]> {
    throw new Error("Method not implemented.");
  }
  public async getStateCommittes(
    stateId: StateId,
    epoch: number,
    filters?: ICommittesFilters
  ): Promise<ValidatorBalance[]> {
    throw new Error("Method not implemented.");
  }

  public async getState(stateId: StateId): Promise<BeaconState | null> {
    return resolveStateId(this.config, this.db, this.forkChoice, stateId);
  }
}
