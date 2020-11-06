/* eslint-disable @typescript-eslint/camelcase */

import {ApiController} from "../../types";
import {DefaultQuery} from "fastify";
import {StateId} from "../../../../impl/beacon/state";

type Params = {
  stateId: StateId;
};

export const getStateValidators: ApiController<DefaultQuery, Params> = {
  url: "/states/:stateId/validators",

  handler: async function (req, resp) {
    const validators = await this.api.beacon.state.getStateValidators(req.params.stateId);
    return resp.status(200).send({
      data: validators.map((v) => this.config.types.ValidatorResponse.toJson(v, {case: "snake"})),
    });
  },

  opts: {
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
  },
};
