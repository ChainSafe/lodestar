import {ApiController, HttpHeader} from "../types";

const SSZ_MIME_TYPE = "application/octet-stream";

export const getState: ApiController<null, {stateId: string}> = {
  url: "/beacon/states/:stateId",
  method: "GET",
  id: "getState",

  handler: async function (req, resp) {
    const state = await this.api.debug.beacon.getState(req.params.stateId);
    if (req.headers[HttpHeader.ACCEPT] === SSZ_MIME_TYPE) {
      const stateSsz = this.config.getTypes(state.slot).BeaconState.serialize(state);
      return resp.status(200).header(HttpHeader.CONTENT_TYPE, SSZ_MIME_TYPE).send(Buffer.from(stateSsz));
    } else {
      // Send 200 JSON
      return {
        data: this.config.getTypes(state.slot).BeaconState.toJson(state, {case: "snake"}),
      };
    }
  },

  schema: {
    params: {
      type: "object",
      required: ["stateId"],
      properties: {
        blockId: {
          types: "string",
        },
      },
    },
  },
};
