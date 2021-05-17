import {Json} from "@chainsafe/ssz";
import {ApiController} from "../types";

export const publishContributionAndProofs: ApiController<null, null, Json[]> = {
  url: "/eth/v1/validator/contribution_and_proofs",
  method: "POST",
  id: "publishContributionAndProofs",

  handler: async function (req) {
    const items = req.body.map((item) =>
      this.config.types.altair.SignedContributionAndProof.fromJson(item, {case: "snake"})
    );

    await this.api.validator.publishContributionAndProofs(items);
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
