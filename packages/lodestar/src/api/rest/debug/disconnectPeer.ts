import {createFromB58String} from "peer-id";
import {ApiController} from "../types";

export const disconnectPeer: ApiController<null, {peerId: string}> = {
  url: "/eth/v1/debug/disconnect/:peerId",
  method: "POST",
  id: "disconnectPeer",

  handler: async function (req) {
    const peer = createFromB58String(req.params.peerId);
    await this.api.debug.disconnectPeer(peer);
    return {};
  },

  schema: {
    params: {
      type: "object",
      required: ["peerId"],
      properties: {
        peerId: {
          types: "string",
        },
      },
    },
  },
};
