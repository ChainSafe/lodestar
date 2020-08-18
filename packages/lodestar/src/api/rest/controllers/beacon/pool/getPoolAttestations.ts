/* eslint-disable @typescript-eslint/camelcase */
import {ApiController} from "../../types";

export const getPoolAttestations: ApiController<{slot: string; committee_index: string}> = {

  url: "/v1/beacon/pool/attestations",

  handler: async function (req, resp) {
    const attestations = await this.api.beacon.pool.getAttestations({
      slot: Number(req.query.slot),
      committeeIndex: Number(req.query.committee_index)
    });
    resp.status(200).send({
      data: attestations.map((attestation) => {
        return this.config.types.Attestation.toJson(attestation, {case: "snake"});
      })
    });
  },

  opts: {
    schema: {
      querystring: {
        type: "object",
        required: [],
        properties: {
          slot: {
            types: "number",
            min: 0
          },
          committee_index: {
            types: "number",
            min: 0
          }
        }
      }
    }
  }
};
