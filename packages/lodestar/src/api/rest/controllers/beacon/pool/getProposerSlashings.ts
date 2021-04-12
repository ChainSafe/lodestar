import {ApiController} from "../../types";

export const getProposerSlashings: ApiController = {
  url: "/pool/proposer_slashings",
  method: "GET",

  handler: async function (req, resp) {
    const proposerSlashings = await this.api.beacon.pool.getProposerSlashings();
    resp.status(200).send({
      data: proposerSlashings.map((slashing) => {
        return this.config.types.phase0.ProposerSlashing.toJson(slashing, {case: "snake"});
      }),
    });
  },
};
