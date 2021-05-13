import {StateId} from "../../../impl/beacon/state";
import {ApiController} from "../../types";

export const getStateRoot: ApiController<null, {stateId: StateId}> = {
  url: "/eth/v1/beacon/states/:stateId/root",
  method: "GET",
  id: "getStateRoot",

  handler: async function (req) {
    const root = await this.api.beacon.state.getStateRoot(req.params.stateId);
    return {
      data: root,
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
