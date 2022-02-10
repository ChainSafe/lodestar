import {routes} from "@chainsafe/lodestar-api";
// eslint-disable-next-line no-restricted-imports
import {Api as IBeaconStateApi} from "@chainsafe/lodestar-api/lib/routes/beacon/state";
import {allForks, altair} from "@chainsafe/lodestar-types";
import {readonlyValues} from "@chainsafe/ssz";
import {
  CachedBeaconStateAltair,
  computeEpochAtSlot,
  getCurrentEpoch,
} from "@chainsafe/lodestar-beacon-state-transition";
import {ApiError} from "../../errors";
import {ApiModules} from "../../types";
import {
  filterStateValidatorsByStatuses,
  getStateValidatorIndex,
  getValidatorStatus,
  resolveStateId,
  toValidatorResponse,
} from "./utils";

export function getBeaconStateApi({chain, config, db}: Pick<ApiModules, "chain" | "config" | "db">): IBeaconStateApi {
  async function getState(stateId: routes.beacon.StateId): Promise<allForks.BeaconState> {
    return await resolveStateId(config, chain, db, stateId);
  }

  return {
    async getStateRoot(stateId) {
      const state = await getState(stateId);
      return {data: config.getForkTypes(state.slot).BeaconState.hashTreeRoot(state)};
    },

    async getStateFork(stateId) {
      const state = await getState(stateId);
      return {data: state.fork};
    },

    async getStateFinalityCheckpoints(stateId) {
      const state = await getState(stateId);
      return {
        data: {
          currentJustified: state.currentJustifiedCheckpoint,
          previousJustified: state.previousJustifiedCheckpoint,
          finalized: state.finalizedCheckpoint,
        },
      };
    },

    async getStateValidators(stateId, filters) {
      const state = await resolveStateId(config, chain, db, stateId);
      const currentEpoch = getCurrentEpoch(state);
      const {validators, balances} = state; // Get the validators sub tree once for all the loop
      const {pubkey2index} = chain.getHeadState();

      const validatorResponses: routes.beacon.ValidatorResponse[] = [];
      if (filters?.indices) {
        for (const id of filters.indices) {
          const validatorIndex = getStateValidatorIndex(id, state, pubkey2index);
          if (validatorIndex != null) {
            const validator = validators[validatorIndex];
            if (filters.statuses && !filters.statuses.includes(getValidatorStatus(validator, currentEpoch))) {
              continue;
            }
            const validatorResponse = toValidatorResponse(
              validatorIndex,
              validator,
              balances[validatorIndex],
              currentEpoch
            );
            validatorResponses.push(validatorResponse);
          }
        }
        return {data: validatorResponses};
      } else if (filters?.statuses) {
        const validatorsByStatus = filterStateValidatorsByStatuses(filters.statuses, state, pubkey2index, currentEpoch);
        return {data: validatorsByStatus};
      }

      let index = 0;
      const resp: routes.beacon.ValidatorResponse[] = [];
      for (const v of readonlyValues(state.validators)) {
        resp.push(toValidatorResponse(index, v, balances[index], currentEpoch));
        index++;
      }
      return {data: resp};
    },

    async getStateValidator(stateId, validatorId) {
      const state = await resolveStateId(config, chain, db, stateId);
      const {pubkey2index} = chain.getHeadState();

      const validatorIndex = getStateValidatorIndex(validatorId, state, pubkey2index);
      if (validatorIndex == null) {
        throw new ApiError(404, "Validator not found");
      }

      return {
        data: toValidatorResponse(
          validatorIndex,
          state.validators[validatorIndex],
          state.balances[validatorIndex],
          getCurrentEpoch(state)
        ),
      };
    },

    async getStateValidatorBalances(stateId, indices) {
      const state = await resolveStateId(config, chain, db, stateId);

      if (indices) {
        const headState = chain.getHeadState();
        const balances: routes.beacon.ValidatorBalance[] = [];
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
        return {data: balances};
      }

      const balances = Array.from(readonlyValues(state.balances), (balance, index) => {
        return {
          index,
          balance,
        };
      });
      return {data: balances};
    },

    async getEpochCommittees(stateId, filters) {
      const state = await resolveStateId(config, chain, db, stateId);

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

      return {data: committesFlat};
    },

    /**
     * Retrieves the sync committees for the given state.
     * @param epoch Fetch sync committees for the given epoch. If not present then the sync committees for the epoch of the state will be obtained.
     */
    async getEpochSyncCommittees(stateId, epoch) {
      // TODO: Should pick a state with the provided epoch too
      const state = (await resolveStateId(config, chain, db, stateId)) as altair.BeaconState;

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
      };
    },
  };
}
