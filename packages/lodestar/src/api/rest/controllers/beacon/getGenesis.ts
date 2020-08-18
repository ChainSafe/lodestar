import {ApiController} from "../types";

export const getGenesis: ApiController = {

  url: "/v1/beacon/genesis",

  handler: async function (req, resp) {
    const genesis = await this.api.beacon.getGenesis();
    if(!genesis) {
      return resp.status(404).send();
    }
    return resp.status(200).send({
      data: this.config.types.Genesis.toJson(genesis, {case: "snake"})
    });
  },

  opts: {
    schema: {
    }
  }
};
