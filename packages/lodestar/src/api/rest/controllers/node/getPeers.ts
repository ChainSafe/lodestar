import {ApiController} from "../types";
import {objectToExpectedCase} from "@chainsafe/lodestar-utils/lib/misc";

export const getPeers: ApiController = {
  url: "/v1/node/peers",
  opts: {
    schema: {}
  },
  handler: async function(req, resp) {
    const peers = await this.api.node.getPeers();
    resp.status(200).send({
      data: peers.map((peer) => objectToExpectedCase(peer, "snake"))
    });
  }
};
