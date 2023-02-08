import {routes, ServerApi} from "@lodestar/api";
import {
  BeaconStateAllForks,
  CachedBeaconStateAltair,
  computeEpochAtSlot,
  getCurrentEpoch,
} from "@lodestar/state-transition";
import {ApiError} from "../../errors.js";
import {ApiModules} from "../../types.js";
import {
  filterStateValidatorsByStatus,
  getStateValidatorIndex,
  getValidatorStatus,
  resolveStateId,
  toValidatorResponse,
} from "./utils.js";

export function getBeaconStateApi({
  chain,
  config,
  db,
}: Pick<ApiModules, "chain" | "config" | "db">): ServerApi<routes.beacon.state.Api> {
  async function getState(
    stateId: routes.beacon.StateId
  ): Promise<{state: BeaconStateAllForks; executionOptimistic: boolean}> {
    return resolveStateId(config, chain, db, stateId);
  }

  return {
    async getStateRoot(stateId) {
      const {state, executionOptimistic} = await getState(stateId);
      return {
        executionOptimistic,
        data: {root: state.hashTreeRoot()},
      };
    },

    async getStateFork(stateId) {
      const {state, executionOptimistic} = await getState(stateId);
      return {
        executionOptimistic,
        data: state.fork,
      };
    },

    async getStateFinalityCheckpoints(stateId) {
      const {state, executionOptimistic} = await getState(stateId);
      return {
        executionOptimistic,
        data: {
          currentJustified: state.currentJustifiedCheckpoint,
          previousJustified: state.previousJustifiedCheckpoint,
          finalized: state.finalizedCheckpoint,
        },
      };
    },

    async getStateValidators(stateId, filters) {
      const {state, executionOptimistic} = await resolveStateId(config, chain, db, stateId);
      const currentEpoch = getCurrentEpoch(state);
      const {validators, balances} = state; // Get the validators sub tree once for all the loop
      const {pubkey2index} = chain.getHeadState().epochCtx;

      const validatorResponses: routes.beacon.ValidatorResponse[] = [];
      if (filters?.id) {
        for (const id of filters.id) {
          const resp = getStateValidatorIndex(id, state, pubkey2index);
          if (resp.valid) {
            const validatorIndex = resp.validatorIndex;
            const validator = validators.getReadonly(validatorIndex);
            if (filters.status && !filters.status.includes(getValidatorStatus(validator, currentEpoch))) {
              continue;
            }
            const validatorResponse = toValidatorResponse(
              validatorIndex,
              validator,
              balances.get(validatorIndex),
              currentEpoch
            );
            validatorResponses.push(validatorResponse);
          }
        }
        return {
          executionOptimistic,
          data: validatorResponses,
        };
      } else if (filters?.status) {
        const validatorsByStatus = filterStateValidatorsByStatus(filters.status, state, pubkey2index, currentEpoch);
        return {
          executionOptimistic,
          data: validatorsByStatus,
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
        executionOptimistic,
        data: resp,
      };
    },

    async getStateValidator(stateId, validatorId) {
      const {state, executionOptimistic} = await resolveStateId(config, chain, db, stateId);
      const {pubkey2index} = chain.getHeadState().epochCtx;

      const resp = getStateValidatorIndex(validatorId, state, pubkey2index);
      if (!resp.valid) {
        throw new ApiError(resp.code, resp.reason);
      }

      const validatorIndex = resp.validatorIndex;
      return {
        executionOptimistic,
        data: toValidatorResponse(
          validatorIndex,
          state.validators.getReadonly(validatorIndex),
          state.balances.get(validatorIndex),
          getCurrentEpoch(state)
        ),
      };
    },

    async getStateValidatorBalances(stateId, indices) {
      const {state, executionOptimistic} = await resolveStateId(config, chain, db, stateId);

      if (indices) {
        const headState = chain.getHeadState();
        const balances: routes.beacon.ValidatorBalance[] = [];
        for (const id of indices) {
          if (typeof id === "number") {
            if (state.validators.length <= id) {
              continue;
            }
            balances.push({index: id, balance: state.balances.get(id)});
          } else {
            const index = headState.epochCtx.pubkey2index.get(id);
            if (index != null && index <= state.validators.length) {
              balances.push({index, balance: state.balances.get(index)});
            }
          }
        }
        return {
          executionOptimistic,
          data: balances,
        };
      }

      // TODO: This loops over the entire state, it's a DOS vector
      const balancesArr = state.balances.getAll();
      const resp: routes.beacon.ValidatorBalance[] = [];
      for (let i = 0; i < balancesArr.length; i++) {
        resp.push({index: i, balance: balancesArr[i]});
      }
      return {
        executionOptimistic,
        data: resp,
      };
    },

    async getEpochCommittees(stateId, filters) {
      const {state, executionOptimistic} = await resolveStateId(config, chain, db, stateId);

      const stateCached = state as CachedBeaconStateAltair;
      if (stateCached.epochCtx === undefined) {
        throw new ApiError(400, `No cached state available for stateId: ${stateId}`);
      }

      const shuffling = stateCached.epochCtx.getShufflingAtEpoch(filters?.epoch ?? computeEpochAtSlot(state.slot));
      const committes = shuffling.committees;
      const committesFlat = committes.flatMap((slotCommittees, committeeIndex) => {
        if (filters?.index !== undefined && filters.index !== committeeIndex) {
          return [];
        }
        return slotCommittees.flatMap((committee, slot) => {
          if (filters?.slot !== undefined && filters.slot !== slot) {
            return [];
          }
          return [
            {
              index: committeeIndex,
              slot,
              validators: committee,
            },
          ];
        });
      });

      return {
        executionOptimistic,
        data: committesFlat,
      };
    },

    /**
     * Retrieves the sync committees for the given state.
     * @param epoch Fetch sync committees for the given epoch. If not present then the sync committees for the epoch of the state will be obtained.
     */
    async getEpochSyncCommittees(stateId, epoch) {
      // TODO: Should pick a state with the provided epoch too
      const {state, executionOptimistic} = await resolveStateId(config, chain, db, stateId);

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
        executionOptimistic,
        data: {
          validators: syncCommitteeCache.validatorIndices,
          // TODO: This is not used by the validator and will be deprecated soon
          validatorAggregates: [],
        },
      };
    },
  };
}
