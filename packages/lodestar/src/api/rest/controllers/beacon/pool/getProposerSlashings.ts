import {ApiController} from "../../types";

export const getProposerSlashings: ApiController = {
  url: "/pool/proposer_slashings",
  method: "GET",

  handler: async function () {
    const proposerSlashings = await this.api.beacon.pool.getProposerSlashings();
    return {
      data: proposerSlashings.map((slashing) =>
        this.config.types.phase0.ProposerSlashing.toJson(slashing, {case: "snake"})
      ),
    };
  },
};
