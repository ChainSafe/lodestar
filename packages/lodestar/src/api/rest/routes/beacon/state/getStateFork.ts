import {ApiController} from "../../types";
import {DefaultQuery} from "fastify";
import {StateId} from "../../../../impl/beacon/state";

type Params = {
  stateId: StateId;
};

export const getStateFork: ApiController<DefaultQuery, Params> = {
  url: "/states/:stateId/fork",
  method: "GET",

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
