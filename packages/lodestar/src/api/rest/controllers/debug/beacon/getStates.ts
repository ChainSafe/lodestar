import {ApiController, HttpHeader} from "../../types";
import {DefaultQuery} from "fastify";
import {toRestValidationError} from "../../utils";

const SSZ_MIME_TYPE = "application/octet-stream";

export const getState: ApiController<DefaultQuery, {stateId: string}> = {
  url: "/beacon/states/:stateId",
  method: "GET",

  handler: async function (req, resp) {
    try {
      const state = await this.api.debug.beacon.getState(req.params.stateId);
      if (!state) {
        return resp.status(404).send();
      }
      if (req.headers[HttpHeader.ACCEPT] === SSZ_MIME_TYPE) {
        const stateSsz = this.config.getTypes(state.slot).BeaconState.serialize(state);
        return resp.status(200).header(HttpHeader.CONTENT_TYPE, SSZ_MIME_TYPE).send(Buffer.from(stateSsz));
      } else {
        // Send 200 JSON
        return {
          data: this.config.getTypes(state.slot).BeaconState.toJson(state, {case: "snake"}),
        };
      }
    } catch (e) {
      if ((e as Error).message === "Invalid state id") {
        throw toRestValidationError("state_id", (e as Error).message);
      }
      throw e;
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
