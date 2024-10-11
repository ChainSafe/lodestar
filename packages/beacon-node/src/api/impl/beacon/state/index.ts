import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {
  BeaconStateAllForks,
  CachedBeaconStateAltair,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getCurrentEpoch,
  getRandaoMix,
} from "@lodestar/state-transition";
import {EPOCHS_PER_HISTORICAL_VECTOR} from "@lodestar/params";
import {getValidatorStatus} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {ApiError} from "../../errors.js";
import {ApiModules} from "../../types.js";
import {filterStateValidatorsByStatus, getStateValidatorIndex, getStateResponse, toValidatorResponse} from "./utils.js";

export function getBeaconStateApi({
  chain,
  config,
  logger,
}: Pick<ApiModules, "chain" | "config" | "logger">): ApplicationMethods<routes.beacon.state.Endpoints> {
  async function getState(
    stateId: routes.beacon.StateId
  ): Promise<{state: BeaconStateAllForks; executionOptimistic: boolean; finalized: boolean}> {
    return getStateResponse(chain, stateId);
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

      const randao = getRandaoMix(state, usedEpoch);

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
      const {state, executionOptimistic, finalized} = await getStateResponse(chain, stateId);
      const currentEpoch = getCurrentEpoch(state);
      const {validators, balances} = state; // Get the validators sub tree once for all the loop
      const {pubkey2index} = chain.getHeadState().epochCtx;

      const validatorResponses: routes.beacon.ValidatorResponse[] = [];
      if (validatorIds.length) {
        for (const id of validatorIds) {
          const resp = getStateValidatorIndex(id, state, pubkey2index);
          if (resp.valid) {
            const validatorIndex = resp.validatorIndex;
            const validator = validators.getReadonly(validatorIndex);
            if (statuses.length && !statuses.includes(getValidatorStatus(validator, currentEpoch))) {
              continue;
            }
            const validatorResponse = toValidatorResponse(
              validatorIndex,
              validator,
              balances.get(validatorIndex),
              currentEpoch
            );
            validatorResponses.push(validatorResponse);
          } else {
            logger.warn(resp.reason, {id});
          }
        }
        return {
          data: validatorResponses,
          meta: {executionOptimistic, finalized},
        };
      } else if (statuses.length) {
        const validatorsByStatus = filterStateValidatorsByStatus(statuses, state, pubkey2index, currentEpoch);
        return {
          data: validatorsByStatus,
          meta: {executionOptimistic, finalized},
        };
      }

      // TODO: This loops over the entire state, it's a DOS vector
      const validatorsArr = state.validators.getAllReadonlyValues();
      const balancesArr = state.balances.getAll();
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
      const {state, executionOptimistic, finalized} = await getStateResponse(chain, stateId);
      const {pubkey2index} = chain.getHeadState().epochCtx;

      let validatorIdentities: routes.beacon.ValidatorIdentities;

      if (validatorIds.length) {
        validatorIdentities = [];
        for (const id of validatorIds) {
          const resp = getStateValidatorIndex(id, state, pubkey2index);
          if (resp.valid) {
            const index = resp.validatorIndex;
            const {pubkey, activationEpoch} = state.validators.getReadonly(index);
            validatorIdentities.push({index, pubkey, activationEpoch});
          } else {
            logger.warn(resp.reason, {id});
          }
        }
      } else {
        const validatorsArr = state.validators.getAllReadonlyValues();
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
      const {state, executionOptimistic, finalized} = await getStateResponse(chain, stateId);
      const {pubkey2index} = chain.getHeadState().epochCtx;

      const resp = getStateValidatorIndex(validatorId, state, pubkey2index);
      if (!resp.valid) {
        throw new ApiError(resp.code, resp.reason);
      }

      const validatorIndex = resp.validatorIndex;
      return {
        data: toValidatorResponse(
          validatorIndex,
          state.validators.getReadonly(validatorIndex),
          state.balances.get(validatorIndex),
          getCurrentEpoch(state)
        ),
        meta: {executionOptimistic, finalized},
      };
    },

    async getStateValidatorBalances({stateId, validatorIds = []}) {
      const {state, executionOptimistic, finalized} = await getStateResponse(chain, stateId);

      if (validatorIds.length) {
        const headState = chain.getHeadState();
        const balances: routes.beacon.ValidatorBalance[] = [];
        for (const id of validatorIds) {
          if (typeof id === "number") {
            if (state.validators.length <= id) {
              continue;
            }
            balances.push({index: id, balance: state.balances.get(id)});
          } else {
            const index = headState.epochCtx.pubkey2index.get(fromHex(id));
            if (index != null && index <= state.validators.length) {
              balances.push({index, balance: state.balances.get(index)});
            }
          }
        }
        return {
          data: balances,
          meta: {executionOptimistic, finalized},
        };
      }

      // TODO: This loops over the entire state, it's a DOS vector
      const balancesArr = state.balances.getAll();
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
      const {state, executionOptimistic, finalized} = await getStateResponse(chain, stateId);

      const stateCached = state as CachedBeaconStateAltair;
      if (stateCached.epochCtx === undefined) {
        throw new ApiError(400, `No cached state available for stateId: ${stateId}`);
      }

      const epoch = filters.epoch ?? computeEpochAtSlot(state.slot);
      const startSlot = computeStartSlotAtEpoch(epoch);
      const decisionRoot = stateCached.epochCtx.getShufflingDecisionRoot(epoch);
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
      const {state, executionOptimistic, finalized} = await getStateResponse(chain, stateId);

      // TODO: If possible compute the syncCommittees in advance of the fork and expose them here.
      // So the validators can prepare and potentially attest the first block. Not critical tho, it's very unlikely
      const stateEpoch = computeEpochAtSlot(state.slot);
      if (stateEpoch < config.ALTAIR_FORK_EPOCH) {
        throw new ApiError(400, "Requested state before ALTAIR_FORK_EPOCH");
      }

      const stateCached = state as CachedBeaconStateAltair;
      if (stateCached.epochCtx === undefined) {
        throw new ApiError(400, `No cached state available for stateId: ${stateId}`);
      }

      const syncCommitteeCache = stateCached.epochCtx.getIndexedSyncCommitteeAtEpoch(epoch ?? stateEpoch);

      return {
        data: {
          validators: syncCommitteeCache.validatorIndices,
          // TODO: This is not used by the validator and will be deprecated soon
          validatorAggregates: [],
        },
        meta: {executionOptimistic, finalized},
      };
    },
  };
}
