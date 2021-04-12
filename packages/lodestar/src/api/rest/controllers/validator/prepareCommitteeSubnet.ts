/* eslint-disable @typescript-eslint/naming-convention */
import {ApiController} from "../types";
import {DefaultParams, DefaultQuery} from "fastify";

type CommitteeSubnetRequest = {
  validator_index: number;
  committee_index: number;
  committees_at_slot: number;
  slot: number;
  is_aggregator: boolean;
};

type Body = CommitteeSubnetRequest[];

export const prepareCommitteeSubnet: ApiController<DefaultQuery, DefaultParams, Body> = {
  url: "/beacon_committee_subscriptions",
  method: "POST",

  handler: async function (req, resp) {
    await this.api.validator.prepareBeaconCommitteeSubnet(
      req.body.map((item) => ({
        validatorIndex: item.validator_index,
        committeeIndex: item.committee_index,
        committeesAtSlot: item.committees_at_slot,
        slot: item.slot,
        isAggregator: item.is_aggregator,
      }))
    );

    resp.status(200).send();
  },

  opts: {
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
  },
};
