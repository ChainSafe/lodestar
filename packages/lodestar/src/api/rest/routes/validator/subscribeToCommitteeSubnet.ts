import fastify, {DefaultBody, DefaultHeaders, DefaultParams, DefaultQuery} from "fastify";
import {LodestarRestApiEndpoint} from "../../interface";
import {fromHexString} from "@chainsafe/ssz";


const opts: fastify.RouteShorthandOptions = {
  schema: {
    body: {
      type: "object",
      requiredKeys: ["committee_index", "slot", "slot_signature", "aggregator_pubkey"],
      "committee_index": {
        type: "string"
      },
      "slot": {
        type: "string"
      },
      "slot_signature": {
        type: "string"
      },
      "aggregator_pubkey": {
        type: "string"
      },
    },
  }
};

interface IBody extends DefaultBody {
  committee_index: string;
  slot: string;
  slot_signature: string;
  aggregator_pubkey: string;
}

export const registerSubscribeToCommitteeSubnet: LodestarRestApiEndpoint = (fastify, {api, config}): void => {
  fastify.post<DefaultQuery, DefaultParams, DefaultHeaders, IBody>(
    "/beacon_committee_subscription",
    opts,
    async (request, reply) => {
      await api.validator.subscribeCommitteeSubnet(
        Number(request.body.slot),
        fromHexString(request.body.slot_signature),
        Number(request.body.committee_index),
        fromHexString(request.body.aggregator_pubkey)
      );
      reply
        .code(200)
        .type("application/json")
        .send();
    }
  );
};
