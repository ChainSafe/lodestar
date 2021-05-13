import {Json} from "@chainsafe/ssz";
import {ApiController} from "../types";

/* eslint-disable @typescript-eslint/naming-convention */

export const prepareSyncCommitteeSubnets: ApiController<null, null, Json[]> = {
  url: "/eth/v1/validator/sync_committee_subscriptions",
  method: "POST",
  id: "prepareSyncCommitteeSubnets",

  handler: async function (req) {
    await this.api.validator.prepareSyncCommitteeSubnets(
      req.body.map((item) => this.config.types.altair.SyncCommitteeSubscription.fromJson(item, {case: "snake"}))
    );
    return {};
  },

  schema: {
    body: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["validator_index", "sync_committee_indices", "until_epoch"],
        properties: {
          validator_index: {
            type: "number",
            minimum: 0,
          },
          sync_committee_indices: {
            type: "array",
            minItems: 1,
            items: {
              type: "number",
              minimum: 0,
            },
          },
          until_epoch: {
            type: "number",
            minimum: 0,
          },
        },
      },
    },
  },
};
