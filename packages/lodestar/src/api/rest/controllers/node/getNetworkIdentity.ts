import {ApiController} from "../types";

/* eslint-disable @typescript-eslint/naming-convention */

export const getNetworkIdentity: ApiController = {
  url: "/identity",
  method: "GET",
  opts: {
    schema: {},
  },
  handler: async function (req, resp) {
    const identity = await this.api.node.getNodeIdentity();
    const metadataJson = this.config.types.phase0.Metadata.toJson(identity.metadata, {case: "snake"});
    resp.status(200).send({
      data: {
        peer_id: identity.peerId,
        enr: identity.enr,
        p2p_addresses: identity.p2pAddresses,
        discovery_addresses: identity.discoveryAddresses,
        metadata: metadataJson,
      },
    });
  },
};
