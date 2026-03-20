import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {EPOCHS_PER_HISTORICAL_VECTOR, SLOTS_PER_EPOCH, SYNC_COMMITTEE_SUBNET_SIZE} from "@lodestar/params";
import {
  IBeaconStateView,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getCurrentEpoch,
  isStatePostElectra,
  isStatePostFulu,
} from "@lodestar/state-transition";
import {ValidatorIndex, getValidatorStatus, ssz} from "@lodestar/types";
import {ApiError} from "../../errors.js";
import {ApiModules} from "../../types.js";
import {assertUniqueItems} from "../../utils.js";
import {
  filterStateValidatorsByStatus,
  getStateResponseWithRegen,
  getStateValidatorIndex,
  toValidatorResponse,
} from "./utils.js";

export function getBeaconStateApi({
  chain,
  config,
}: Pick<ApiModules, "chain" | "config">): ApplicationMethods<routes.beacon.state.Endpoints> {
  async function getState(
    stateId: routes.beacon.StateId
  ): Promise<{state: IBeaconStateView; executionOptimistic: boolean; finalized: boolean}> {
    const {state, executionOptimistic, finalized} = await getStateResponseWithRegen(chain, stateId);

    return {
      state: state instanceof Uint8Array ? chain.getHeadState().loadOtherState(state) : state,
      executionOptimistic,
      finalized,
    };
  }

  return {
    async getStateRoot({stateId}) {
      const {state, executionOptimistic, finalized} = await getState(stateId);
      return {
        data: {root: state.hashTreeRoot()},
        meta: {executionOptimistic, finalized},
      };
    },

    async getStateFork({stateId}) {
      const {state, executionOptimistic, finalized} = await getState(stateId);
      return {
        data: state.fork,
        meta: {executionOptimistic, finalized},
      };
    },

    async getStateRandao({stateId, epoch}) {
      const {state, executionOptimistic, finalized} = await getState(stateId);
      const stateEpoch = computeEpochAtSlot(state.slot);
      const usedEpoch = epoch ?? stateEpoch;

      if (!(stateEpoch < usedEpoch + EPOCHS_PER_HISTORICAL_VECTOR && usedEpoch <= stateEpoch)) {
        throw new ApiError(400, "Requested epoch is out of range");
      }

      const randao = state.getRandaoMix(usedEpoch);

      return {
        data: {randao},
        meta: {executionOptimistic, finalized},
      };
    },

    async getStateFinalityCheckpoints({stateId}) {
      const {state, executionOptimistic, finalized} = await getState(stateId);
      return {
        data: {
          currentJustified: state.currentJustifiedCheckpoint,
          previousJustified: state.previousJustifiedCheckpoint,
          finalized: state.finalizedCheckpoint,
        },
        meta: {executionOptimistic, finalized},
      };
    },

    async getStateValidators({stateId, validatorIds = [], statuses = []}) {
      const {state, executionOptimistic, finalized} = await getState(stateId);
      const currentEpoch = getCurrentEpoch(state);
      const {pubkeyCache} = chain;

      const validatorResponses: routes.beacon.ValidatorResponse[] = [];
      if (validatorIds.length) {
        assertUniqueItems(validatorIds, "Duplicate validator IDs provided");

        for (const id of validatorIds) {
          const resp = getStateValidatorIndex(id, state, pubkeyCache);
          if (resp.valid) {
            const validatorIndex = resp.validatorIndex;
            const validator = state.getValidator(validatorIndex);
            if (statuses.length && !statuses.includes(getValidatorStatus(validator, currentEpoch))) {
              continue;
            }
            const validatorResponse = toValidatorResponse(
              validatorIndex,
              validator,
              state.getBalance(validatorIndex),
              currentEpoch
            );
            validatorResponses.push(validatorResponse);
          }
        }
        return {
          data: validatorResponses,
          meta: {executionOptimistic, finalized},
        };
      }

      if (statuses.length) {
        assertUniqueItems(statuses, "Duplicate statuses provided");

        const validatorsByStatus = filterStateValidatorsByStatus(statuses, state, pubkeyCache, currentEpoch);
        return {
          data: validatorsByStatus,
          meta: {executionOptimistic, finalized},
        };
      }

      // TODO: This loops over the entire state, it's a DOS vector
      const validatorsArr = state.getAllValidators();
      const balancesArr = state.getAllBalances();
      const resp: routes.beacon.ValidatorResponse[] = [];
      for (let i = 0; i < validatorsArr.length; i++) {
        resp.push(toValidatorResponse(i, validatorsArr[i], balancesArr[i], currentEpoch));
      }

      return {
        data: resp,
        meta: {executionOptimistic, finalized},
      };
    },

    async postStateValidators(args, context) {
      return this.getStateValidators(args, context);
    },

    async postStateValidatorIdentities({stateId, validatorIds = []}) {
      const {state, executionOptimistic, finalized} = await getState(stateId);
      const {pubkeyCache} = chain;

      let validatorIdentities: routes.beacon.ValidatorIdentities;

      if (validatorIds.length) {
        assertUniqueItems(validatorIds, "Duplicate validator IDs provided");

        validatorIdentities = [];
        for (const id of validatorIds) {
          const resp = getStateValidatorIndex(id, state, pubkeyCache);
          if (resp.valid) {
            const index = resp.validatorIndex;
            const {pubkey, activationEpoch} = state.getValidator(index);
            validatorIdentities.push({index, pubkey, activationEpoch});
          }
        }
      } else {
        const validatorsArr = state.getAllValidators();
        validatorIdentities = new Array(validatorsArr.length) as routes.beacon.ValidatorIdentities;
        for (let i = 0; i < validatorsArr.length; i++) {
          const {pubkey, activationEpoch} = validatorsArr[i];
          validatorIdentities[i] = {index: i, pubkey, activationEpoch};
        }
      }

      return {
        data: validatorIdentities,
        meta: {executionOptimistic, finalized},
      };
    },

    async getStateValidator({stateId, validatorId}) {
      const {state, executionOptimistic, finalized} = await getState(stateId);
      const {pubkeyCache} = chain;

      const resp = getStateValidatorIndex(validatorId, state, pubkeyCache);
      if (!resp.valid) {
        throw new ApiError(resp.code, resp.reason);
      }

      const validatorIndex = resp.validatorIndex;
      return {
        data: toValidatorResponse(
          validatorIndex,
          state.getValidator(validatorIndex),
          state.getBalance(validatorIndex),
          getCurrentEpoch(state)
        ),
        meta: {executionOptimistic, finalized},
      };
    },

    async getStateValidatorBalances({stateId, validatorIds = []}) {
      const {state, executionOptimistic, finalized} = await getState(stateId);

      if (validatorIds.length) {
        assertUniqueItems(validatorIds, "Duplicate validator IDs provided");

        const balances: routes.beacon.ValidatorBalance[] = [];
        for (const id of validatorIds) {
          const resp = getStateValidatorIndex(id, state, chain.pubkeyCache);

          if (resp.valid) {
            balances.push({
              index: resp.validatorIndex,
              balance: state.getBalance(resp.validatorIndex),
            });
          }
        }
        return {
          data: balances,
          meta: {executionOptimistic, finalized},
        };
      }

      // TODO: This loops over the entire state, it's a DOS vector
      const balancesArr = state.getAllBalances();
      const resp: routes.beacon.ValidatorBalance[] = [];
      for (let i = 0; i < balancesArr.length; i++) {
        resp.push({index: i, balance: balancesArr[i]});
      }
      return {
        data: resp,
        meta: {executionOptimistic, finalized},
      };
    },

    async postStateValidatorBalances(args, context) {
      return this.getStateValidatorBalances(args, context);
    },

    async getEpochCommittees({stateId, ...filters}) {
      const {state, executionOptimistic, finalized} = await getState(stateId);

      const stateEpoch = computeEpochAtSlot(state.slot);
      const epoch = filters.epoch ?? stateEpoch;
      const startSlot = computeStartSlotAtEpoch(epoch);
      const endSlot = startSlot + SLOTS_PER_EPOCH - 1;

      if (Math.abs(epoch - stateEpoch) > 1) {
        throw new ApiError(400, `Epoch ${epoch} must be within one epoch of state epoch ${stateEpoch}`);
      }

      if (filters.slot !== undefined && (filters.slot < startSlot || filters.slot > endSlot)) {
        throw new ApiError(400, `Slot ${filters.slot} is not in epoch ${epoch}`);
      }

      const decisionRoot = state.getShufflingDecisionRoot(epoch);
      const shuffling = await chain.shufflingCache.get(epoch, decisionRoot);
      if (!shuffling) {
        throw new ApiError(
          500,
          `No shuffling found to calculate committees for epoch: ${epoch} and decisionRoot: ${decisionRoot}`
        );
      }
      const committees = shuffling.committees;
      const committeesFlat = committees.flatMap((slotCommittees, slotInEpoch) => {
        const slot = startSlot + slotInEpoch;
        if (filters.slot !== undefined && filters.slot !== slot) {
          return [];
        }
        return slotCommittees.flatMap((committee, committeeIndex) => {
          if (filters.index !== undefined && filters.index !== committeeIndex) {
            return [];
          }
          return [
            {
              index: committeeIndex,
              slot,
              validators: Array.from(committee),
            },
          ];
        });
      });

      return {
        data: committeesFlat,
        meta: {executionOptimistic, finalized},
      };
    },

    /**
     * Retrieves the sync committees for the given state.
     * @param epoch Fetch sync committees for the given epoch. If not present then the sync committees for the epoch of the state will be obtained.
     */
    async getEpochSyncCommittees({stateId, epoch}) {
      // TODO: Should pick a state with the provided epoch too
      const {state, executionOptimistic, finalized} = await getState(stateId);

      // TODO: If possible compute the syncCommittees in advance of the fork and expose them here.
      // So the validators can prepare and potentially attest the first block. Not critical tho, it's very unlikely
      const stateEpoch = computeEpochAtSlot(state.slot);
      if (stateEpoch < config.ALTAIR_FORK_EPOCH) {
        throw new ApiError(400, "Requested state before ALTAIR_FORK_EPOCH");
      }

      const syncCommitteeCache = state.getIndexedSyncCommitteeAtEpoch(epoch ?? stateEpoch);
      const validatorIndices = new Array<ValidatorIndex>(...syncCommitteeCache.validatorIndices);

      // Subcommittee assignments of the current sync committee
      const validatorAggregates: ValidatorIndex[][] = [];
      for (let i = 0; i < validatorIndices.length; i += SYNC_COMMITTEE_SUBNET_SIZE) {
        validatorAggregates.push(validatorIndices.slice(i, i + SYNC_COMMITTEE_SUBNET_SIZE));
      }

      return {
        data: {
          validators: validatorIndices,
          validatorAggregates,
        },
        meta: {executionOptimistic, finalized},
      };
    },

    async getPendingDeposits({stateId}, context) {
      const {state, executionOptimistic, finalized} = await getState(stateId);
      const fork = state.forkName;

      if (!isStatePostElectra(state)) {
        throw new ApiError(400, `Cannot retrieve pending deposits for pre-electra state fork=${fork}`);
      }

      const pendingDeposits = state.pendingDeposits;

      return {
        data: context?.returnBytes ? ssz.electra.PendingDeposits.serialize(pendingDeposits) : pendingDeposits,
        meta: {executionOptimistic, finalized, version: fork},
      };
    },

    async getPendingPartialWithdrawals({stateId}, context) {
      const {state, executionOptimistic, finalized} = await getState(stateId);
      const fork = state.forkName;

      if (!isStatePostElectra(state)) {
        throw new ApiError(400, `Cannot retrieve pending partial withdrawals for pre-electra state fork=${fork}`);
      }

      const pendingPartialWithdrawals = state.pendingPartialWithdrawals;

      return {
        data: context?.returnBytes
          ? ssz.electra.PendingPartialWithdrawals.serialize(pendingPartialWithdrawals)
          : pendingPartialWithdrawals,
        meta: {executionOptimistic, finalized, version: fork},
      };
    },

    async getPendingConsolidations({stateId}, context) {
      const {state, executionOptimistic, finalized} = await getState(stateId);
      const fork = state.forkName;

      if (!isStatePostElectra(state)) {
        throw new ApiError(400, `Cannot retrieve pending consolidations for pre-electra state fork=${fork}`);
      }

      const pendingConsolidations = state.pendingConsolidations;

      return {
        data: context?.returnBytes
          ? ssz.electra.PendingConsolidations.serialize(pendingConsolidations)
          : pendingConsolidations,
        meta: {executionOptimistic, finalized, version: fork},
      };
    },

    async getProposerLookahead({stateId}, context) {
      const {state, executionOptimistic, finalized} = await getState(stateId);
      const fork = state.forkName;

      if (!isStatePostFulu(state)) {
        throw new ApiError(400, `Cannot retrieve proposer lookahead for pre-fulu state fork=${fork}`);
      }

      const proposerLookahead = state.proposerLookahead;

      return {
        data: context?.returnBytes ? ssz.fulu.ProposerLookahead.serialize(proposerLookahead) : proposerLookahead,
        meta: {executionOptimistic, finalized, version: fork},
      };
    },
  };
}
