import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Root, phase0, allForks, BLSPubkey, Epoch, altair} from "@chainsafe/lodestar-types";
import {List, readonlyValues} from "@chainsafe/ssz";
import {computeEpochAtSlot, getCurrentEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconChain} from "../../../../chain/interface";
import {IBeaconDb} from "../../../../db";
import {IApiOptions} from "../../../options";
import {IApiModules} from "../../interface";
import {getStateValidatorIndex} from "../../utils";
import {ApiError} from "../../errors";
import {IBeaconStateApi, ICommitteesFilters, IValidatorFilters, StateId} from "./interface";
import {
  filterStateValidatorsByStatuses,
  getEpochBeaconCommittees,
  getSyncCommittees,
  getValidatorStatus,
  resolveStateId,
  toValidatorResponse,
} from "./utils";

export class BeaconStateApi implements IBeaconStateApi {
  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly chain: IBeaconChain;

  constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config" | "db" | "chain">) {
    this.config = modules.config;
    this.db = modules.db;
    this.chain = modules.chain;
  }

  async getStateRoot(stateId: StateId): Promise<Root> {
    const state = await this.getState(stateId);
    return this.config.getForkTypes(state.slot).BeaconState.hashTreeRoot(state);
  }

  async getStateFinalityCheckpoints(stateId: StateId): Promise<phase0.FinalityCheckpoints> {
    const state = await this.getState(stateId);
    return {
      currentJustified: state.currentJustifiedCheckpoint,
      previousJustified: state.previousJustifiedCheckpoint,
      finalized: state.finalizedCheckpoint,
    };
  }

  async getStateValidators(stateId: StateId, filters?: IValidatorFilters): Promise<phase0.ValidatorResponse[]> {
    const state = await resolveStateId(this.config, this.chain, this.db, stateId);
    const currentEpoch = getCurrentEpoch(this.config, state);

    const validators: phase0.ValidatorResponse[] = [];
    if (filters?.indices) {
      for (const id of filters.indices) {
        const validatorIndex = getStateValidatorIndex(id, state, this.chain);
        if (validatorIndex != null) {
          const validator = state.validators[validatorIndex];
          if (filters.statuses && !filters.statuses.includes(getValidatorStatus(validator, currentEpoch))) {
            continue;
          }
          const validatorResponse = toValidatorResponse(
            validatorIndex,
            validator,
            state.balances[validatorIndex],
            currentEpoch
          );
          validators.push(validatorResponse);
        }
      }
      return validators;
    } else if (filters?.statuses) {
      const validatorsByStatus = filterStateValidatorsByStatuses(filters.statuses, state, this.chain, currentEpoch);
      return validatorsByStatus;
    }

    let index = 0;
    const resp: phase0.ValidatorResponse[] = [];
    for (const v of readonlyValues(state.validators)) {
      resp.push(toValidatorResponse(index, v, state.balances[index], currentEpoch));
      index++;
    }
    return resp;
  }

  async getStateValidator(
    stateId: StateId,
    validatorId: phase0.ValidatorIndex | Root
  ): Promise<phase0.ValidatorResponse> {
    const state = await resolveStateId(this.config, this.chain, this.db, stateId);

    const validatorIndex = getStateValidatorIndex(validatorId, state, this.chain);
    if (validatorIndex == null) {
      throw new ApiError(404, "Validator not found");
    }

    return toValidatorResponse(
      validatorIndex,
      state.validators[validatorIndex],
      state.balances[validatorIndex],
      getCurrentEpoch(this.config, state)
    );
  }

  async getStateValidatorBalances(
    stateId: StateId,
    indices?: (phase0.ValidatorIndex | BLSPubkey)[]
  ): Promise<phase0.ValidatorBalance[]> {
    const state = await resolveStateId(this.config, this.chain, this.db, stateId);

    if (indices) {
      const headState = this.chain.getHeadState();
      const balances: phase0.ValidatorBalance[] = [];
      for (const id of indices) {
        if (typeof id === "number") {
          if (state.validators.length <= id) {
            continue;
          }
          balances.push({index: id, balance: state.balances[id]});
        } else {
          const index = headState.pubkey2index.get(id);
          if (index != null && index <= state.validators.length) {
            balances.push({index, balance: state.balances[index]});
          }
        }
      }
      return balances;
    }
    return Array.from(readonlyValues(state.balances), (balance, index) => {
      return {
        index,
        balance,
      };
    });
  }

  async getStateCommittees(stateId: StateId, filters?: ICommitteesFilters): Promise<phase0.BeaconCommitteeResponse[]> {
    const state = await resolveStateId(this.config, this.chain, this.db, stateId);

    const committes = getEpochBeaconCommittees(
      this.config,
      state,
      filters?.epoch ?? computeEpochAtSlot(this.config, state.slot)
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
            validators: committee as List<phase0.ValidatorIndex>,
          },
        ];
      });
    });
  }

  /**
   * Retrieves the sync committees for the given state.
   * @param epoch Fetch sync committees for the given epoch. If not present then the sync committees for the epoch of the state will be obtained.
   */
  async getEpochSyncCommittees(stateId: StateId, epoch?: Epoch): Promise<altair.SyncCommitteeByValidatorIndices> {
    // TODO: Should pick a state with the provided epoch too
    const state = (await resolveStateId(this.config, this.chain, this.db, stateId)) as altair.BeaconState;

    // TODO: If possible compute the syncCommittees in advance of the fork and expose them here.
    // So the validators can prepare and potentially attest the first block. Not critical tho, it's very unlikely
    const stateEpoch = computeEpochAtSlot(this.config, state.slot);
    if (stateEpoch < this.config.params.ALTAIR_FORK_EPOCH) {
      throw new ApiError(400, "Requested state before ALTAIR_FORK_EPOCH");
    }

    return {
      validators: getSyncCommittees(this.config, state, epoch ?? stateEpoch),
      // TODO: This is not used by the validator and will be deprecated soon
      validatorAggregates: [],
    };
  }

  async getState(stateId: StateId): Promise<allForks.BeaconState> {
    return await resolveStateId(this.config, this.chain, this.db, stateId);
  }

  async getFork(stateId: StateId): Promise<phase0.Fork> {
    return (await this.getState(stateId))?.fork;
  }
}
