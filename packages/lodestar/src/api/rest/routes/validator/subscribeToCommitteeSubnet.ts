import {IFastifyServer} from "../../index";
import fastify, {DefaultBody, DefaultHeaders, DefaultParams, DefaultQuery} from "fastify";
import {IApiModules} from "../../../interface";
import {verify} from "@chainsafe/bls";
import {hexToBuffer} from "../../../../util/hex";
import {computeEpochAtSlot, getDomain} from "@chainsafe/lodestar-beacon-state-transition";
import {DomainType} from "../../../../constants";


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

export const registerSubscribeToCommitteeSubnet = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.post<DefaultQuery, DefaultParams, DefaultHeaders, IBody>(
    "/beacon_committee_subscription",
    opts,
    async (request, reply) => {
      const slot = Number(request.body.slot);
      const valid = verify(
        hexToBuffer(request.body.aggregator_pubkey),
        modules.config.types.Slot.hashTreeRoot(slot),
        hexToBuffer(request.body.slot_signature),
        getDomain(
          modules.config,
          modules.chain.latestState,
          DomainType.BEACON_ATTESTER,
          computeEpochAtSlot(modules.config, slot))
      );
      if(!valid) {
        reply
          .code(403)
          .send();
        return;
      }
      modules.sync.regularSync.collectAttestations(
        slot,
        Number(request.body.committee_index)
      );
      reply
        .code(200)
        .type("application/json")
        .send();
    }
  );
};
