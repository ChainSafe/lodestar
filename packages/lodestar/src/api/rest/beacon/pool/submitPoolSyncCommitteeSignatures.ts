import {Json} from "@chainsafe/ssz";
import {ApiController} from "../../types";

export const submitPoolSyncCommitteeSignatures: ApiController<null, null, Json[]> = {
  url: "/eth/v1/beacon/pool/sync_committees",
  method: "POST",
  id: "submitPoolSyncCommitteeSignatures",

  handler: async function (req) {
    const signatures = req.body.map((item) =>
      this.config.types.altair.SyncCommitteeSignature.fromJson(item, {case: "snake"})
    );

    await this.api.beacon.pool.submitSyncCommitteeSignatures(signatures);
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
