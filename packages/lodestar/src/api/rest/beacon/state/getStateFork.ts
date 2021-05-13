import {StateId} from "../../../impl/beacon/state";
import {ApiController} from "../../types";

export const getStateFork: ApiController<null, {stateId: StateId}> = {
  url: "/eth/v1/beacon/states/:stateId/fork",
  method: "GET",
  id: "getStateFork",

  handler: async function (req) {
    const fork = await this.api.beacon.state.getFork(req.params.stateId);
    return {
      data: this.config.types.phase0.Fork.toJson(fork, {case: "snake"}),
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
  },
};
