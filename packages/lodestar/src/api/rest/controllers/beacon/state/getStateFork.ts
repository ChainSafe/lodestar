import {ApiController} from "../../types";
import {DefaultQuery} from "fastify";
import {FastifyError} from "fastify";

export const getStateFork: ApiController<DefaultQuery, {stateId: string}> = {
  url: "/state/:stateId/fork",

  handler: async function (req, resp) {
    try {
      const fork = await this.api.beacon.state.getFork(req.params.stateId);
      if (!fork) {
        return resp.status(404).send();
      }
      return resp.status(200).send({
        data: this.config.types.Fork.toJson(fork, {case: "snake"}),
      });
    } catch (e) {
      if (e.message === "Invalid state id") {
        //TODO: fix when unifying errors
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
          stateId: {
            types: "string",
          },
        },
      },
    },
  },
};
