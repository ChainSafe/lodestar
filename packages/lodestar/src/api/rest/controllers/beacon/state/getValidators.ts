import {ApiController} from "../../types";
import {IValidatorFilters, StateId, ValidatorStatus} from "../../../../impl/beacon/state";
import {mapValidatorIndices} from "../../utils";

type Params = {
  stateId: StateId;
};

type ValidatorsQuery = {
  indices?: string[];
  statuses?: string[];
};

export const getStateValidators: ApiController<ValidatorsQuery, Params> = {
  url: "/states/:stateId/validators",
  method: "GET",

  handler: async function (req, resp) {
    const filters: IValidatorFilters = {};
    if (req.query.indices) {
      filters.indices = mapValidatorIndices(this.config, req.query.indices);
    }
    if (req.query.statuses) {
      filters.statuses = req.query.statuses as ValidatorStatus[];
    }
    const validators = await this.api.beacon.state.getStateValidators(req.params.stateId, filters);
    return resp.status(200).send({
      data: validators.map((v) => v && this.config.types.phase0.ValidatorResponse.toJson(v, {case: "snake"})),
    });
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
