import {StateId} from "../../../impl/beacon/state";
import {ApiController} from "../../types";

/* eslint-disable @typescript-eslint/naming-convention */

export const getStateFinalityCheckpoints: ApiController<null, {stateId: StateId}> = {
  url: "/states/:stateId/finality_checkpoints",
  method: "GET",

  handler: async function (req) {
    const state = await this.api.beacon.state.getState(req.params.stateId);
    const checkpointType = this.config.types.phase0.Checkpoint;
    return {
      data: {
        previous_justified: checkpointType.toJson(state.previousJustifiedCheckpoint, {case: "snake"}),
        current_justified: checkpointType.toJson(state.currentJustifiedCheckpoint, {case: "snake"}),
        finalized: checkpointType.toJson(state.finalizedCheckpoint, {case: "snake"}),
      },
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
