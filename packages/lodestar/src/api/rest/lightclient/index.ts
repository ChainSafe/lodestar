import {serializeProof} from "@chainsafe/persistent-merkle-tree";
import {ApiController, HttpHeader} from "../types";
import {ApiError} from "../../impl/errors";

export const createProof: ApiController<null, {stateId: string}, {paths: (string | number)[][]}> = {
  url: "/eth/v1/lightclient/proof/:stateId",
  method: "POST",
  id: "createProof",

  handler: async function (req, resp) {
    const proof = await this.api.lightclient.createStateProof(req.params.stateId, req.body.paths);
    const serialized = serializeProof(proof);
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

export const getBestUpdates: ApiController<null, {periods: string}> = {
  url: "/eth/v1/lightclient/best_updates/:periods",
  method: "GET",
  id: "getBestUpdates",

  handler: async function (req) {
    const {from, to} = parsePeriods(req.params.periods);
    const items = await this.api.lightclient.getBestUpdates(from, to);
    return {
      data: items.map((item) => this.config.types.altair.LightClientUpdate.toJson(item, {case: "snake"})),
    };
  },

  schema: {
    params: {
      type: "object",
      required: ["periods"],
      properties: {
        stateId: {
          types: "string",
        },
      },
    },
  },
};

export const getLatestUpdateFinalized: ApiController = {
  url: "/eth/v1/lightclient/latest_update_finalized/",
  method: "GET",
  id: "getLatestUpdateFinalized",

  handler: async function () {
    const data = await this.api.lightclient.getLatestUpdateFinalized();
    if (!data) throw new ApiError(404, "No update available");
    return {
      data: this.config.types.altair.LightClientUpdate.toJson(data, {case: "snake"}),
    };
  },
};

export const getLatestUpdateNonFinalized: ApiController = {
  url: "/eth/v1/lightclient/latest_update_nonfinalized/",
  method: "GET",
  id: "getLatestUpdateNonFinalized",

  handler: async function () {
    const data = await this.api.lightclient.getLatestUpdateNonFinalized();
    if (!data) throw new ApiError(404, "No update available");
    return {
      data: this.config.types.altair.LightClientUpdate.toJson(data, {case: "snake"}),
    };
  },
};

/**
 * periods = 1 or = 1..4
 */
function parsePeriods(periods: string): {from: number; to: number} {
  if (periods.includes("..")) {
    const [from, to] = periods.split("..");
    return {from: parseInt(from, 10), to: parseInt(to, 10)};
  } else {
    const period = parseInt(periods, 10);
    return {from: period, to: period};
  }
}
