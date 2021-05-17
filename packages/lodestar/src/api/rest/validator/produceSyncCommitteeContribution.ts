import {fromHexString} from "@chainsafe/ssz";
import {ApiController} from "../types";

/* eslint-disable @typescript-eslint/naming-convention */

type Query = {
  slot: number;
  subcommittee_index: number;
  beacon_block_root: string;
};

export const produceSyncCommitteeContribution: ApiController<Query> = {
  url: "/eth/v1/validator/sync_committee_contribution",
  method: "GET",
  id: "produceSyncCommitteeContribution",

  handler: async function (req) {
    const data = await this.api.validator.produceSyncCommitteeContribution(
      req.query.slot,
      req.query.subcommittee_index,
      fromHexString(req.query.beacon_block_root)
    );
    return {
      data: this.config.types.altair.SyncCommitteeContribution.toJson(data, {case: "snake"}),
    };
  },

  schema: {
    querystring: {
      type: "object",
      required: ["committee_index", "slot"],
      properties: {
        slot: {
          type: "number",
          minimum: 0,
        },
        subcommittee_index: {
          type: "number",
          minimum: 0,
        },
        beacon_block_root: {
          type: "string",
        },
      },
    },
  },
};
