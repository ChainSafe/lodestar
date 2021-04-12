import {ApiController} from "../../types";
import {DefaultQuery} from "fastify";
import {StateId} from "../../../../impl/beacon/state";
import {toRestValidationError} from "../../utils";

/* eslint-disable @typescript-eslint/naming-convention */

type Params = {
  stateId: StateId;
};

export const getStateFinalityCheckpoints: ApiController<DefaultQuery, Params> = {
  url: "/states/:stateId/finality_checkpoints",
  method: "GET",

  handler: async function (req, resp) {
    try {
      const state = await this.api.beacon.state.getState(req.params.stateId);
      if (!state) {
        return resp.status(404).send();
      }
      const checkpointType = this.config.types.phase0.Checkpoint;
      return {
        data: {
          previous_justified: checkpointType.toJson(state.previousJustifiedCheckpoint, {case: "snake"}),
          current_justified: checkpointType.toJson(state.currentJustifiedCheckpoint, {case: "snake"}),
          finalized: checkpointType.toJson(state.finalizedCheckpoint, {case: "snake"}),
        },
      };
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
        stateId: {
          types: "string",
        },
      },
    },
  },
};
