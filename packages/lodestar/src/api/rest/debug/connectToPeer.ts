import Multiaddr from "multiaddr";
import {createFromB58String} from "peer-id";
import {ApiController} from "../types";

export const connectToPeer: ApiController<null, {peerId: string}, string[]> = {
  url: "/eth/v1/debug/connect/:peerId",
  method: "POST",
  id: "connectToPeer",

  handler: async function (req) {
    const multiaddrStr = req.body || [];
    const multiaddr = multiaddrStr.map((addr) => new Multiaddr(addr));
    const peer = createFromB58String(req.params.peerId);
    await this.api.debug.connectToPeer(peer, multiaddr);
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

    body: {
      type: "array",
      items: {
        type: "string",
      },
    },
  },
};
