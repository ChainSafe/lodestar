import {ApiController} from "../../types";

export const getAttesterSlashings: ApiController = {
  url: "/pool/attester_slashings",
  method: "GET",

  handler: async function () {
    const attesterSlashings = await this.api.beacon.pool.getAttesterSlashings();
    return {
      data: attesterSlashings.map((slashing) =>
        this.config.types.phase0.AttesterSlashing.toJson(slashing, {case: "snake"})
      ),
    };
  },
};
