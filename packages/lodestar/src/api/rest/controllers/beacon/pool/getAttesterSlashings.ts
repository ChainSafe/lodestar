import {ApiController} from "../../types";

export const getAttesterSlashings: ApiController = {
  url: "/pool/attester_slashings",

  handler: async function (req, resp) {
    const attesterSlashings = await this.api.beacon.pool.getAttesterSlashings();
    resp.status(200).send({
      data: attesterSlashings.map((slashing) => {
        return this.config.types.phase0.AttesterSlashing.toJson(slashing, {case: "snake"});
      }),
    });
  },

  opts: {
    schema: {},
  },
};
