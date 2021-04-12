import {ApiController} from "../../types";

export const getVoluntaryExits: ApiController = {
  url: "/pool/voluntary_exits",
  method: "GET",

  handler: async function (req, resp) {
    const exits = await this.api.beacon.pool.getVoluntaryExits();
    resp.status(200).send({
      data: exits.map((exit) => {
        return this.config.types.phase0.SignedVoluntaryExit.toJson(exit, {case: "snake"});
      }),
    });
  },

  opts: {
    schema: {},
  },
};
