import {ApiController} from "../../types";

/* eslint-disable @typescript-eslint/naming-convention */

export const getPoolAttestations: ApiController<{slot: string; committee_index: string}> = {
  url: "/pool/attestations",
  method: "GET",
  id: "getPoolAttestations",

  handler: async function (req) {
    const attestations = await this.api.beacon.pool.getAttestations({
      slot: Number(req.query.slot),
      committeeIndex: Number(req.query.committee_index),
    });
    return {
      data: attestations.map((attestation) =>
        this.config.types.phase0.Attestation.toJson(attestation, {case: "snake"})
      ),
    };
  },

  schema: {
    querystring: {
      type: "object",
      required: [],
      properties: {
        slot: {
          types: "number",
          min: 0,
        },
        committee_index: {
          types: "number",
          min: 0,
        },
      },
    },
  },
};
