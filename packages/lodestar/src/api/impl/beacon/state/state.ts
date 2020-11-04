import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {
  BeaconCommitteeResponse,
  BeaconState,
  Epoch,
  FinalityCheckpoints,
  Fork,
  Root,
  ValidatorBalance,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {List, readOnlyMap} from "@chainsafe/ssz";
import {IBeaconChain} from "../../../../chain/interface";
import {IBeaconDb} from "../../../../db/api";
import {notNullish} from "../../../../util/notNullish";
import {IApiOptions} from "../../../options";
import {ValidatorResponse} from "../../../types/validator";
import {ApiError, StateNotFound} from "../../errors/api";
import {IApiModules} from "../../interface";
import {MissingState} from "./errors";
import {IBeaconStateApi, ICommittesFilters, IValidatorFilters, StateId} from "./interface";
import {getEpochBeaconCommittees, resolveStateId, toValidatorResponse, validatorPubkeyToIndex} from "./utils";

export class BeaconStateApi implements IBeaconStateApi {
  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly forkChoice: IForkChoice;
  private readonly chain: IBeaconChain;

  public constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config" | "db" | "chain">) {
    this.config = modules.config;
    this.db = modules.db;
    this.forkChoice = modules.chain.forkChoice;
    this.chain = modules.chain;
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async getStateValidators(stateId: StateId, filters?: IValidatorFilters): Promise<ValidatorResponse[]> {
    const state = await resolveStateId(this.config, this.db, this.forkChoice, stateId);
    if (!state) {
      throw new StateNotFound();
    }
    //TODO: implement filters
    return readOnlyMap(state.state.validators, (v, index) => toValidatorResponse(index, v));
  }

  public async getStateValidator(
    stateId: StateId,
    validatorId: ValidatorIndex | Root
  ): Promise<ValidatorResponse | null> {
    const state = await resolveStateId(this.config, this.db, this.forkChoice, stateId);
    if (!state) {
      throw new StateNotFound();
    }
    let validatorIndex: ValidatorIndex | undefined;
    if (typeof validatorId === "number") {
      if (state.state.validators.length > validatorId) {
        validatorIndex = validatorId;
      }
    } else {
      validatorIndex = validatorPubkeyToIndex(this.config, state, validatorId) ?? undefined;
    }
    if (!validatorIndex) {
      throw new ApiError(404, "Validator not found");
    }
    return toValidatorResponse(validatorIndex, state.state.validators[validatorIndex]);
  }
  public async getStateValidatorBalances(
    stateId: StateId,
    indices?: (ValidatorIndex | Root)[]
  ): Promise<ValidatorBalance[]> {
    const state = await resolveStateId(this.config, this.db, this.forkChoice, stateId);
    if (!state) {
      throw new StateNotFound();
    }
    if (indices) {
      return indices
        .map((id) => {
          if (typeof id === "number") {
            if (state.state.validators.length <= id) {
              return null;
            }
            return {
              index: id,
              balance: state.state.balances[id],
            };
          } else {
            const index = validatorPubkeyToIndex(this.config, state, id);
            return index && index <= state.state.validators.length
              ? {index, balance: state.state.balances[index]}
              : null;
          }
        })
        .filter(notNullish);
    }
    return readOnlyMap(state.state.validators, (v, index) => {
      return {
        index,
        balance: state.state.balances[index],
      };
    });
  }
  public async getStateCommittes(
    stateId: StateId,
    epoch: Epoch,
    filters?: ICommittesFilters
  ): Promise<BeaconCommitteeResponse[]> {
    const stateContext = await resolveStateId(this.config, this.db, this.forkChoice, stateId);
    if (!stateContext) {
      throw new MissingState();
    }
    const committes: ValidatorIndex[][][] = getEpochBeaconCommittees(this.config, this.chain, stateContext, epoch);
    return committes.flatMap((slotCommittees, committeeIndex) => {
      if (filters?.index && filters.index !== committeeIndex) {
        return [];
      }
      return slotCommittees.flatMap((committee, slot) => {
        if (filters?.slot && filters.slot !== slot) {
          return [];
        }
        return [
          {
            index: committeeIndex,
            slot,
            validators: committee as List<ValidatorIndex>,
          },
        ];
      });
    });
  }

  public async getState(stateId: StateId): Promise<BeaconState | null> {
    return (await resolveStateId(this.config, this.db, this.forkChoice, stateId))?.state ?? null;
  }

  public async getFork(stateId: StateId): Promise<Fork | null> {
    return (await this.getState(stateId))?.fork ?? null;
  }
}
