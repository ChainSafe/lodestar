import {ApiController} from "../types";

/* eslint-disable @typescript-eslint/naming-convention */

export const getNetworkIdentity: ApiController = {
  url: "/identity",
  method: "GET",
  id: "getNetworkIdentity",

  handler: async function () {
    const identity = await this.api.node.getNodeIdentity();
    const metadataJson = this.config.types.phase0.Metadata.toJson(identity.metadata, {case: "snake"});
    return {
      data: {
        peer_id: identity.peerId,
        enr: identity.enr,
        p2p_addresses: identity.p2pAddresses,
        discovery_addresses: identity.discoveryAddresses,
        metadata: metadataJson,
      },
    };
  },
};
