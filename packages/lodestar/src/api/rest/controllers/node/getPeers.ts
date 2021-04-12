import {ApiController} from "../types";

/* eslint-disable @typescript-eslint/naming-convention */

export const getPeers: ApiController<{state: string[] | string; direction: string[] | string}> = {
  url: "/peers",
  method: "GET",

  handler: async function (req, resp) {
    const peers = await this.api.node.getPeers(
      typeof req.query.state === "string" ? [req.query.state] : req.query.state,
      typeof req.query.direction === "string" ? [req.query.direction] : req.query.direction
    );
    resp.status(200).send({
      data: peers.map((peer) => ({
        peer_id: peer.peerId,
        enr: peer.enr,
        last_seen_p2p_address: peer.lastSeenP2pAddress,
        state: peer.state,
        direction: peer.direction,
      })),
    });
  },

  schema: {
    querystring: {
      type: "object",
      required: [],
      properties: {
        state: {
          types: "array",
          uniqueItems: true,
          maxItems: 4,
          items: {
            type: "string",
            enum: ["disconnected", "connecting", "connected", "disconnecting"],
          },
        },
        direction: {
          types: "array",
          uniqueItems: true,
          maxItems: 2,
          items: {
            type: "string",
            enum: ["inbound", "outbound"],
          },
        },
      },
    },
  },
};
