import {IValidatorFilters, StateId, ValidatorStatus} from "../../../impl/beacon/state";
import {ApiController} from "../../types";
import {mapValidatorIndices} from "../../utils";

type ValidatorsQuery = {
  indices?: string[];
  statuses?: string[];
};

export const getStateValidators: ApiController<ValidatorsQuery, {stateId: StateId}> = {
  url: "/eth/v1/beacon/states/:stateId/validators",
  method: "GET",
  id: "getStateValidators",

  handler: async function (req) {
    const filters: IValidatorFilters = {};
    if (req.query.indices) {
      filters.indices = mapValidatorIndices(this.config, req.query.indices);
    }
    if (req.query.statuses) {
      filters.statuses = req.query.statuses as ValidatorStatus[];
    }
    const validators = await this.api.beacon.state.getStateValidators(req.params.stateId, filters);
    return {
      data: validators.map((v) => v && this.config.types.phase0.ValidatorResponse.toJson(v, {case: "snake"})),
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
        indices: {
          type: "array",
          uniqueItems: true,
          items: {
            type: "string",
          },
        },
        statuses: {
          type: "array",
          uniqueItems: true,
          items: {
            type: "string",
          },
        },
      },
    },
  },
};
