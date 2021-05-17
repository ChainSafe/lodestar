import {phase0} from "@chainsafe/lodestar-types";
import {StateId} from "../../../impl/beacon/state/interface";
import {ApiController} from "../../types";

export const getStateValidator: ApiController<null, {stateId: StateId; validatorId: string}> = {
  url: "/eth/v1/beacon/states/:stateId/validators/:validatorId",
  method: "GET",
  id: "getStateValidator",

  handler: async function (req) {
    let validator: phase0.ValidatorResponse;
    if (req.params.validatorId.toLowerCase().startsWith("0x")) {
      validator = await this.api.beacon.state.getStateValidator(
        req.params.stateId,
        this.config.types.BLSPubkey.fromJson(req.params.validatorId)
      );
    } else {
      validator = await this.api.beacon.state.getStateValidator(
        req.params.stateId,
        this.config.types.ValidatorIndex.fromJson(req.params.validatorId)
      );
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
