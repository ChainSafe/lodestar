import {allForks} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {serializeProof} from "@chainsafe/persistent-merkle-tree";
import {ApiController, HttpHeader} from "../types";

export const getWtfNode: ApiController = {
  url: "/wtfnode/",
  method: "GET",
  id: "getWtfNode",

  handler: async function () {
    return this.api.lodestar.getWtfNode();
  },
};

export const getLatestWeakSubjectivityCheckpointEpoch: ApiController = {
  url: "/ws_epoch/",
  method: "GET",
  id: "getLatestWeakSubjectivityCheckpointEpoch",

  handler: async function () {
    return this.api.lodestar.getLatestWeakSubjectivityCheckpointEpoch();
  },
};

export const createProof: ApiController<null, {stateId: string}, {paths: (string | number)[][]}> = {
  url: "/proof/:stateId",
  method: "POST",
  id: "createProof",

  handler: async function (req, resp) {
    const state = (await this.api.debug.beacon.getState(req.params.stateId)) as TreeBacked<allForks.BeaconState>;
    const serialized = serializeProof(state.createProof(req.body.paths));
    return resp.status(200).header(HttpHeader.CONTENT_TYPE, "application/octet-stream").send(Buffer.from(serialized));
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
    body: {
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

export const getSyncChainsDebugState: ApiController<{paths: (string | number)[][]}, {stateId: string}> = {
  url: "/sync-chains-debug-state",
  method: "GET",
  id: "getSyncChainsDebugState",

  handler: async function () {
    return this.api.lodestar.getSyncChainsDebugState();
  },
};

export const lodestarRoutes = [
  getWtfNode,
  getLatestWeakSubjectivityCheckpointEpoch,
  createProof,
  getSyncChainsDebugState,
];
