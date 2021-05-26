import {ApiController, HttpHeader} from "../types";

const SSZ_MIME_TYPE = "application/octet-stream";

// V2 handler is backwards compatible so re-use it for both versions
const handler: ApiController<null, {stateId: string}>["handler"] = async function (req, resp) {
  const state = await this.api.debug.beacon.getState(req.params.stateId);
  const type = this.config.getForkTypes(state.slot).BeaconState;
  if (req.headers[HttpHeader.ACCEPT] === SSZ_MIME_TYPE) {
    const stateSsz = type.serialize(state);
    return resp.status(200).header(HttpHeader.CONTENT_TYPE, SSZ_MIME_TYPE).send(Buffer.from(stateSsz));
  } else {
    // Send 200 JSON
    return {
      version: this.config.getForkName(state.slot),
      data: type.toJson(state, {case: "snake"}),
    };
  }
};

const schema = {
  params: {
    type: "object",
    required: ["stateId"],
    properties: {
      blockId: {
        types: "string",
      },
    },
  },
};

export const getState: ApiController<null, {stateId: string}> = {
  url: "/eth/v1/debug/beacon/states/:stateId",
  method: "GET",
  id: "getState",
  handler,
  schema,
};

export const getStateV2: ApiController<null, {stateId: string}> = {
  url: "/eth/v2/debug/beacon/states/:stateId",
  method: "GET",
  id: "getStateV2",
  handler,
  schema,
};
