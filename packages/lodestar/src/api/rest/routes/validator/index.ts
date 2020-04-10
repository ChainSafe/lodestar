import {registerBlockProductionEndpoint} from "./produceBlock";
import {registerBlockPublishEndpoint} from "./publishBlock";
import {registerAttestationProductionEndpoint} from "./produceAttestation";
import {registerAttestationPublishEndpoint} from "./publishAttestation";
import {registerProposerDutiesEndpoint} from "./duties/proposer";
import {registerAttesterDutiesEndpoint} from "./duties/attester";
import {registerPublishAggregateAndProofEndpoint} from "./publishAggregateAndProof";
import {registerGetWireAttestationEndpoint} from "./getWireAttestations";
import {LodestarApiPlugin} from "../../interface";
import {registerSubscribeToCommitteeSubnet} from "./subscribeToCommitteeSubnet";
import {registerAggregateAndProofProductionEndpoint} from "./produceAggregateAndProof";

export const validator: LodestarApiPlugin =
    (fastify, opts, callback): void => {
      registerProposerDutiesEndpoint(fastify, opts);
      registerAttesterDutiesEndpoint(fastify, opts);
      registerPublishAggregateAndProofEndpoint(fastify, opts);
      registerBlockProductionEndpoint(fastify, opts);
      registerBlockPublishEndpoint(fastify, opts);
      registerAttestationProductionEndpoint(fastify, opts);
      registerAttestationPublishEndpoint(fastify, opts);
      registerSubscribeToCommitteeSubnet(fastify, opts);
      registerGetWireAttestationEndpoint(fastify, opts);
      registerAggregateAndProofProductionEndpoint(fastify, opts);
      callback();
    };