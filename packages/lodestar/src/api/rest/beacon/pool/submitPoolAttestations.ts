import {Json} from "@chainsafe/ssz";
import {ValidationError} from "../../../impl/errors";
import {ApiController} from "../../types";

export const submitPoolAttestations: ApiController<null, null, Json[]> = {
  url: "/eth/v1/beacon/pool/attestations",
  method: "POST",
  id: "submitPoolAttestations",

  handler: async function (req) {
    const attestations = req.body.map((attestation) => {
      try {
        return this.config.types.phase0.Attestation.fromJson(attestation, {case: "snake"});
      } catch (e) {
        throw new ValidationError(`SSZ deserialize error: ${(e as Error).message}`);
      }
    });

    await this.api.beacon.pool.submitAttestations(attestations);
    return {};
  },

  schema: {
    body: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
      },
    },
  },
};
