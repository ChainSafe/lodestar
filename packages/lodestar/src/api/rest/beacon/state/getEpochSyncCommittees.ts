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
    const committees = await this.api.beacon.state.getEpochSyncCommittees(req.params.stateId, req.query.epoch);
    return {
      data: committees.map((item) => this.config.types.altair.SyncCommittee.toJson(item, {case: "snake"})),
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
