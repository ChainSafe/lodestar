import fastify, {DefaultBody, DefaultHeaders, DefaultParams, DefaultQuery} from "fastify";
import {LodestarRestApiEndpoint} from "../../interface";
import {fromHexString} from "@chainsafe/ssz";


const opts: fastify.RouteShorthandOptions = {
  schema: {
    body: {
      type: "object",
      requiredKeys: ["attestationCommitteeIndex", "slot", "slotSignature", "aggregatorPubkey"],
      attestationCommitteeIndex: {
        type: "string"
      },
      slot: {
        type: "string"
      },
      slotSignature: {
        type: "string"
      },
      aggregatorPubkey: {
        type: "string"
      },
    },
  }
};

interface IBody extends DefaultBody {
  attestationCommitteeIndex: string;
  slot: string;
  slotSignature: string;
  aggregatorPubkey: string;
}

export const registerSubscribeToCommitteeSubnet: LodestarRestApiEndpoint = (fastify, {api}): void => {
  fastify.post<DefaultQuery, DefaultParams, DefaultHeaders, IBody>(
    "/beacon_committee_subscription",
    opts,
    async (request, reply) => {
      await api.validator.subscribeCommitteeSubnet(
        Number(request.body.slot),
        fromHexString(request.body.slotSignature),
        Number(request.body.attestationCommitteeIndex),
        fromHexString(request.body.aggregatorPubkey)
      );
      reply
        .code(200)
        .type("application/json")
        .send();
    }
  );
};
