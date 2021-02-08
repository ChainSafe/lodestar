import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {
  BeaconCommitteeResponse,
  BeaconState,
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
import {ApiError, StateNotFound} from "../../errors/api";
import {IApiModules} from "../../interface";
import {IBeaconStateApi, ICommitteesFilters, IValidatorFilters, StateId} from "./interface";
import {getEpochBeaconCommittees, resolveStateId, toValidatorResponse} from "./utils";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {ValidatorResponse} from "@chainsafe/lodestar-types";

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
    const state = await resolveStateId(this.chain, this.db, stateId);
    if (!state) {
      throw new StateNotFound();
    }
    //TODO: implement filters
    return readOnlyMap(state.state.validators, (v, index) =>
      toValidatorResponse(index, v, state.state.balances[index])
    );
  }

  public async getStateValidator(
    stateId: StateId,
    validatorId: ValidatorIndex | Root
  ): Promise<ValidatorResponse | null> {
    const state = await resolveStateId(this.chain, this.db, stateId);
    if (!state) {
      throw new StateNotFound();
    }
    let validatorIndex: ValidatorIndex | undefined;
    if (typeof validatorId === "number") {
      if (state.state.validators.length > validatorId) {
        validatorIndex = validatorId;
      }
    } else {
      validatorIndex = this.chain.getHeadEpochContext().pubkey2index.get(validatorId) ?? undefined;
      // validator added later than given stateId
      if (validatorIndex && validatorIndex >= state.state.validators.length) {
        validatorIndex = undefined;
      }
    }
    if (validatorIndex == null) {
      throw new ApiError(404, "Validator not found");
    }
    return toValidatorResponse(
      validatorIndex,
      state.state.validators[validatorIndex],
      state.state.balances[validatorIndex]
    );
  }

  public async getStateValidatorBalances(
    stateId: StateId,
    indices?: (ValidatorIndex | Root)[]
  ): Promise<ValidatorBalance[]> {
    const state = await resolveStateId(this.chain, this.db, stateId);
    if (!state) {
      throw new StateNotFound();
    }
    if (indices) {
      const epochCtx = this.chain.getHeadEpochContext();
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
            const index = epochCtx.pubkey2index.get(id) ?? undefined;
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

  public async getStateCommittees(stateId: StateId, filters?: ICommitteesFilters): Promise<BeaconCommitteeResponse[]> {
    const stateContext = await resolveStateId(this.chain, this.db, stateId);
    if (!stateContext) {
      throw new StateNotFound();
    }
    const committes: ValidatorIndex[][][] = getEpochBeaconCommittees(
      this.config,
      this.chain,
      stateContext,
      filters?.epoch ?? computeEpochAtSlot(this.config, stateContext.state.slot)
    );
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
    return (await resolveStateId(this.chain, this.db, stateId))?.state ?? null;
  }

  public async getFork(stateId: StateId): Promise<Fork | null> {
    return (await this.getState(stateId))?.fork ?? null;
  }
}
