import {ApiController} from "../types";

/* eslint-disable @typescript-eslint/naming-convention */

export const getPeer: ApiController<null, {peerId: string}> = {
  url: "/peers/:peerId",
  method: "GET",

  handler: async function (req) {
    const peer = await this.api.node.getPeer(req.params.peerId);
    return {
      data: {
        peer_id: peer.peerId,
        enr: peer.enr,
        last_seen_p2p_address: peer.lastSeenP2pAddress,
        state: peer.state,
        direction: peer.direction,
      },
    };
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
