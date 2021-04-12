import {StateId} from "../../../impl/beacon/state";
import {ApiController} from "../../types";

type Query = {
  slot?: number;
  epoch?: number;
  index?: number;
};

export const getStateBeaconCommittees: ApiController<Query, {stateId: StateId}> = {
  url: "/states/:stateId/committees",
  method: "GET",

  handler: async function (req) {
    const committees = await this.api.beacon.state.getStateCommittees(req.params.stateId, {...req.query});
    return {
      data: committees.map((c) => this.config.types.phase0.BeaconCommitteeResponse.toJson(c, {case: "snake"})),
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
        slot: {
          type: "number",
          minimum: 0,
        },
        index: {
          type: "number",
          miminimum: 0,
        },
      },
    },
  },
};
