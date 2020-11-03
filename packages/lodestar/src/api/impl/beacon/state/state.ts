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
import {List} from "@chainsafe/ssz";
import {IBeaconChain} from "../../../../chain/interface";
import {IBeaconDb} from "../../../../db/api";
import {IApiOptions} from "../../../options";
import {ValidatorResponse} from "../../../types/validator";
import {IApiModules} from "../../interface";
import {MissingState} from "./errors";
import {IBeaconStateApi, ICommittesFilters, IValidatorFilters, StateId} from "./interface";
import {getEpochBeaconCommittees, resolveStateId} from "./utils";

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
  public async getStateValidators(stateId: StateId, filters?: IValidatorFilters): Promise<ValidatorResponse[]> {
    throw new Error("Method not implemented.");
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
