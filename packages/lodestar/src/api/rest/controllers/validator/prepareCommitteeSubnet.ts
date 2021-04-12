import {Json} from "@chainsafe/ssz";
import {ApiController} from "../types";
import {DefaultParams, DefaultQuery} from "fastify";

/* eslint-disable @typescript-eslint/naming-convention */

export const prepareCommitteeSubnet: ApiController<DefaultQuery, DefaultParams, Json[]> = {
  url: "/beacon_committee_subscriptions",
  method: "POST",

  handler: async function (req) {
    await this.api.validator.prepareBeaconCommitteeSubnet(
      req.body.map((item) => this.config.types.phase0.BeaconCommitteeSubscription.fromJson(item, {case: "snake"}))
    );
    return {};
  },

  schema: {
    body: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["validator_index", "committee_index", "committees_at_slot", "slot", "is_aggregator"],
        properties: {
          validator_index: {
            type: "number",
            minimum: 0,
          },
          committee_index: {
            type: "number",
            minimum: 0,
          },
          committees_at_slot: {
            type: "number",
            minimum: 0,
          },
          slot: {
            type: "number",
            minimum: 0,
          },
          is_aggregator: {
            type: "boolean",
          },
        },
      },
    },
  },
};
