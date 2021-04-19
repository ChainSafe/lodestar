import {ApiController} from "../../types";

export const getPoolAttesterSlashings: ApiController = {
  url: "/pool/attester_slashings",
  method: "GET",
  id: "getPoolAttesterSlashings",

  handler: async function () {
    const attesterSlashings = await this.api.beacon.pool.getAttesterSlashings();
    return {
      data: attesterSlashings.map((slashing) =>
        this.config.types.phase0.AttesterSlashing.toJson(slashing, {case: "snake"})
      ),
    };
  },
};
