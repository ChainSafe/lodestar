/* eslint-disable @typescript-eslint/camelcase */

import {DefaultQuery} from "fastify";
import {StateId} from "../../../../impl/beacon/state/interface";
import {ApiError} from "../../../../impl/errors/api";
import {ApiController} from "../../types";
import {ValidatorResponse} from "@chainsafe/lodestar-types";

type Params = {
  stateId: StateId;
  validatorId: string;
};

export const getStateValidator: ApiController<DefaultQuery, Params> = {
  url: "/states/:stateId/validators/:validatorId",

  handler: async function (req, resp) {
    let validator: ValidatorResponse | undefined;
    if (req.params.validatorId.toLowerCase().startsWith("0x")) {
      validator =
        (await this.api.beacon.state.getStateValidator(
          req.params.stateId,
          this.config.types.BLSPubkey.fromJson(req.params.validatorId)
        )) ?? undefined;
    } else {
      validator =
        (await this.api.beacon.state.getStateValidator(
          req.params.stateId,
          this.config.types.ValidatorIndex.fromJson(req.params.validatorId)
        )) ?? undefined;
    }
    if (!validator) {
      throw new ApiError(404, "Validator not found");
    }
    return resp.status(200).send({
      data: this.config.types.ValidatorResponse.toJson(validator, {case: "snake"}),
    });
  },

  opts: {
    schema: {
      params: {
        type: "object",
        required: ["stateId", "validatorId"],
        properties: {
          stateId: {
            types: "string",
          },
          validatorId: {
            types: "string",
          },
        },
      },
    },
  },
};
