import {ValidatorIndex, BLSPubkey} from "@chainsafe/lodestar-types";
import {StateId} from "../../../../impl/beacon/state";
import {ApiController} from "../../types";

type Params = {
  stateId: StateId;
};

type Query = {
  id?: string[];
};

export const getStateValidatorsBalances: ApiController<Query, Params> = {
  url: "/states/:stateId/validator_balances",

  handler: async function (req, resp) {
    let indices: (ValidatorIndex | BLSPubkey)[] | undefined;
    if (req.query.id) {
      indices = req.query.id.map((id) => {
        if (id.toLowerCase().startsWith("0x")) {
          return this.config.types.BLSPubkey.fromJson(id);
        } else {
          return this.config.types.ValidatorIndex.fromJson(id);
        }
      });
    }
    const balances = await this.api.beacon.state.getStateValidatorBalances(req.params.stateId, indices);
    return resp.status(200).send({
      data: balances.map((b) => this.config.types.phase0.ValidatorBalance.toJson(b, {case: "snake"})),
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
      querystring: {
        type: "object",
        required: [],
        properties: {
          id: {
            types: "array",
            uniqueItems: true,
            maxItems: 30,
            items: {
              type: "string",
            },
          },
        },
      },
    },
  },
};
