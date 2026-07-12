import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ApiModules} from "../../types.js";
import {assertUniqueItems} from "../../utils.js";
import {resolveStateId, unwrapStateResult, unwrapStateResultWithFork} from "./utils.js";

export function getBeaconStateApi({
  chain,
}: Pick<ApiModules, "chain" | "config">): ApplicationMethods<routes.beacon.state.Endpoints> {
  return {
    async getStateRoot({stateId}) {
      const id = resolveStateId(chain.beaconEngine, stateId);
      const {data, executionOptimistic, finalized} = unwrapStateResult(
        await chain.beaconEngine.getStateRoot(id),
        stateId
      );
      return {data, meta: {executionOptimistic, finalized}};
    },

    async getStateFork({stateId}) {
      const id = resolveStateId(chain.beaconEngine, stateId);
      const {data, executionOptimistic, finalized} = unwrapStateResult(
        await chain.beaconEngine.getStateFork(id),
        stateId
      );
      return {data, meta: {executionOptimistic, finalized}};
    },

    async getStateRandao({stateId, epoch}) {
      const id = resolveStateId(chain.beaconEngine, stateId);
      const {data, executionOptimistic, finalized} = unwrapStateResult(
        await chain.beaconEngine.getStateRandao(id, epoch),
        stateId
      );
      return {data, meta: {executionOptimistic, finalized}};
    },

    async getStateFinalityCheckpoints({stateId}) {
      const id = resolveStateId(chain.beaconEngine, stateId);
      const {data, executionOptimistic, finalized} = unwrapStateResult(
        await chain.beaconEngine.getStateFinalityCheckpoints(id),
        stateId
      );
      return {data, meta: {executionOptimistic, finalized}};
    },

    async getStateValidators({stateId, validatorIds = [], statuses = []}) {
      if (validatorIds.length) {
        assertUniqueItems(validatorIds, "Duplicate validator IDs provided");
      }
      if (statuses.length) {
        assertUniqueItems(statuses, "Duplicate statuses provided");
      }
      const id = resolveStateId(chain.beaconEngine, stateId);
      const {data, executionOptimistic, finalized} = unwrapStateResult(
        await chain.beaconEngine.getStateValidators(id, validatorIds, statuses),
        stateId
      );
      return {data, meta: {executionOptimistic, finalized}};
    },

    async postStateValidators(args, context) {
      return this.getStateValidators(args, context);
    },

    async postStateValidatorIdentities({stateId, validatorIds = []}) {
      if (validatorIds.length) {
        assertUniqueItems(validatorIds, "Duplicate validator IDs provided");
      }
      const id = resolveStateId(chain.beaconEngine, stateId);
      const {data, executionOptimistic, finalized} = unwrapStateResult(
        await chain.beaconEngine.getStateValidatorIdentities(id, validatorIds),
        stateId
      );
      return {data, meta: {executionOptimistic, finalized}};
    },

    async getStateValidator({stateId, validatorId}) {
      const id = resolveStateId(chain.beaconEngine, stateId);
      const {data, executionOptimistic, finalized} = unwrapStateResult(
        await chain.beaconEngine.getStateValidator(id, validatorId),
        stateId
      );
      return {data, meta: {executionOptimistic, finalized}};
    },

    async getStateValidatorBalances({stateId, validatorIds = []}) {
      if (validatorIds.length) {
        assertUniqueItems(validatorIds, "Duplicate validator IDs provided");
      }
      const id = resolveStateId(chain.beaconEngine, stateId);
      const {data, executionOptimistic, finalized} = unwrapStateResult(
        await chain.beaconEngine.getStateValidatorBalances(id, validatorIds),
        stateId
      );
      return {data, meta: {executionOptimistic, finalized}};
    },

    async postStateValidatorBalances(args, context) {
      return this.getStateValidatorBalances(args, context);
    },

    async getEpochCommittees({stateId, ...filters}) {
      const id = resolveStateId(chain.beaconEngine, stateId);
      const {data, executionOptimistic, finalized} = unwrapStateResult(
        await chain.beaconEngine.getEpochCommittees(id, filters),
        stateId
      );
      return {data, meta: {executionOptimistic, finalized}};
    },

    async getEpochSyncCommittees({stateId, epoch}) {
      const id = resolveStateId(chain.beaconEngine, stateId);
      const {data, executionOptimistic, finalized} = unwrapStateResult(
        await chain.beaconEngine.getEpochSyncCommittees(id, epoch),
        stateId
      );
      return {data, meta: {executionOptimistic, finalized}};
    },

    async getPendingDeposits({stateId}, context) {
      const id = resolveStateId(chain.beaconEngine, stateId);
      const {data, executionOptimistic, finalized, fork} = unwrapStateResultWithFork(
        await chain.beaconEngine.getStatePendingDeposits(id, Boolean(context?.returnBytes)),
        stateId
      );
      return {data, meta: {executionOptimistic, finalized, version: fork}};
    },

    async getPendingPartialWithdrawals({stateId}, context) {
      const id = resolveStateId(chain.beaconEngine, stateId);
      const {data, executionOptimistic, finalized, fork} = unwrapStateResultWithFork(
        await chain.beaconEngine.getStatePendingPartialWithdrawals(id, Boolean(context?.returnBytes)),
        stateId
      );
      return {data, meta: {executionOptimistic, finalized, version: fork}};
    },

    async getPendingConsolidations({stateId}, context) {
      const id = resolveStateId(chain.beaconEngine, stateId);
      const {data, executionOptimistic, finalized, fork} = unwrapStateResultWithFork(
        await chain.beaconEngine.getStatePendingConsolidations(id, Boolean(context?.returnBytes)),
        stateId
      );
      return {data, meta: {executionOptimistic, finalized, version: fork}};
    },

    async getProposerLookahead({stateId}, context) {
      const id = resolveStateId(chain.beaconEngine, stateId);
      const {data, executionOptimistic, finalized, fork} = unwrapStateResultWithFork(
        await chain.beaconEngine.getStateProposerLookahead(id, Boolean(context?.returnBytes)),
        stateId
      );
      return {data, meta: {executionOptimistic, finalized, version: fork}};
    },
  };
}
