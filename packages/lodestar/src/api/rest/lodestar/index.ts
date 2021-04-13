import {allForks} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {serializeProof} from "@chainsafe/persistent-merkle-tree";
import {ApiController} from "../types";

export const getWtfNode: ApiController = {
  url: "/wtfnode/",
  method: "GET",

  handler: async function () {
    return this.api.lodestar.getWtfNode();
  },
};

export const getLatestWeakSubjectivityCheckpointEpoch: ApiController = {
  url: "/ws_epoch/",
  method: "GET",

  handler: async function () {
    return this.api.lodestar.getLatestWeakSubjectivityCheckpointEpoch;
  },
};

export const createProof: ApiController<{paths: (string | number)[][]}, {stateId: string}> = {
  url: "/proof/:stateId",
  method: "GET",

  handler: async function (req) {
    const state = (await this.api.debug.beacon.getState(req.params.stateId)) as TreeBacked<allForks.BeaconState>;
    return serializeProof(state.createProof(req.query.paths));
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
      required: ["paths"],
      properties: {
        paths: {
          type: "array",
        },
      },
    },
  },
};

export const lodestarRoutes = [getWtfNode, getLatestWeakSubjectivityCheckpointEpoch, createProof];
