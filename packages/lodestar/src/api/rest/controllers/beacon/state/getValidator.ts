import {DefaultQuery} from "fastify";
import {StateId} from "../../../../impl/beacon/state/interface";
import {ApiError} from "../../../../impl/errors/api";
import {ApiController} from "../../types";
import {phase0} from "@chainsafe/lodestar-types";

type Params = {
  stateId: StateId;
  validatorId: string;
};

export const getStateValidator: ApiController<DefaultQuery, Params> = {
  url: "/states/:stateId/validators/:validatorId",
  method: "GET",

  handler: async function (req) {
    let validator: phase0.ValidatorResponse | undefined;
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
    return {
      data: this.config.types.phase0.ValidatorResponse.toJson(validator, {case: "snake"}),
    };
  },

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
};
