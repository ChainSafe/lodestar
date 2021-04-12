import {phase0} from "@chainsafe/lodestar-types";
import {ValidationError} from "../../../../impl/errors";
import {ApiController} from "../../types";

export const submitPoolAttestation: ApiController = {
  url: "/pool/attestations",
  method: "POST",

  handler: async function (req) {
    let attestation: phase0.Attestation;
    try {
      attestation = this.config.types.phase0.Attestation.fromJson(req.body, {case: "snake"});
    } catch (e) {
      throw new ValidationError(`SSZ deserialize error: ${(e as Error).message}`);
    }
    await this.api.beacon.pool.submitAttestation(attestation);
    return {};
  },

  schema: {
    body: {
      type: "object",
    },
  },
};
