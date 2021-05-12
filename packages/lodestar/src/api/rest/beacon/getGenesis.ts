import {ApiController} from "../types";

export const getGenesis: ApiController = {
  url: "/eth/v1/beacon/genesis",
  method: "GET",
  id: "getGenesis",

  handler: async function () {
    const genesis = await this.api.beacon.getGenesis();
    return {
      data: this.config.types.phase0.Genesis.toJson(genesis, {case: "snake"}),
    };
  },
};
