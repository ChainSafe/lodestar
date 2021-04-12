import {ApiController} from "../types";

export const getGenesis: ApiController = {
  url: "/genesis",
  method: "GET",

  handler: async function (req, resp) {
    const genesis = await this.api.beacon.getGenesis();
    if (!genesis) {
      return resp.status(404).send();
    }
    return {
      data: this.config.types.phase0.Genesis.toJson(genesis, {case: "snake"}),
    };
  },
};
