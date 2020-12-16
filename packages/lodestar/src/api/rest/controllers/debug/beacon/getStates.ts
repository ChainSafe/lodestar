import {ApiController} from "../../types";
import {DefaultQuery} from "fastify";
import {FastifyError} from "fastify";

export const getState: ApiController<DefaultQuery, {stateId: string}> = {
  url: "/beacon/states/:stateId",

  handler: async function (req, resp) {
    try {
      const state = await this.api.debug.beacon.getState(req.params.stateId);
      if (!state) {
        return resp.status(404).send();
      }
      if (req.headers["accept"] === "application/octet-stream") {
        const stateSsz = this.config.types.BeaconState.serialize(state);
        resp.status(200).header("Content-Type", "application/octet-stream").send(Buffer.from(stateSsz));
      } else {
        return resp.status(200).send({
          data: this.config.types.BeaconState.toJson(state, {case: "snake"}),
        });
      }
    } catch (e) {
      if (e.message === "Invalid state id") {
        throw {
          statusCode: 400,
          validation: [
            {
              dataPath: "state_id",
              message: e.message,
            },
          ],
        } as FastifyError;
      }
      throw e;
    }
  },

  opts: {
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
  },
};
