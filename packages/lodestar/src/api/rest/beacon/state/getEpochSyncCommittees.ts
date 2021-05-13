import {StateId} from "../../../impl/beacon/state";
import {ApiController} from "../../types";

type Query = {
  epoch?: number;
};

/** Retrieves the sync committees for the given state. */
export const getEpochSyncCommittees: ApiController<Query, {stateId: StateId}> = {
  url: "/eth/v1/beacon/states/:stateId/sync_committees",
  method: "GET",
  id: "getEpochSyncCommittees",

  handler: async function (req) {
    const data = await this.api.beacon.state.getEpochSyncCommittees(req.params.stateId, req.query.epoch);
    return {
      data: this.config.types.altair.SyncCommitteeByValidatorIndices.toJson(data, {case: "snake"}),
    };
  },

  schema: {
    params: {
      type: "object",
      required: ["stateId"],
      properties: {
        stateId: {
          types: "string",
        },
      },
    },
    querystring: {
      type: "object",
      required: [],
      properties: {
        epoch: {
          type: "number",
          minimum: 0,
        },
      },
    },
  },
};
