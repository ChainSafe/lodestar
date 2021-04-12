import {ApiController} from "../types";

export const getGenesis: ApiController = {
  url: "/genesis",
  method: "GET",

  handler: async function () {
    const genesis = await this.api.beacon.getGenesis();
    return {
      data: this.config.types.phase0.Genesis.toJson(genesis, {case: "snake"}),
    };
  },
};
