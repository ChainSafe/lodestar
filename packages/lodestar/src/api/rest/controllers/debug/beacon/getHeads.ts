import {ApiController} from "../../types";

export const getHeads: ApiController = {
  url: "/beacon/heads",
  method: "GET",

  handler: async function (req, resp) {
    const heads = await this.api.debug.beacon.getHeads();
    if (!heads) {
      return resp.status(404).send();
    }
    const headJsons = heads.map((head) => this.config.types.phase0.SlotRoot.toJson(head, {case: "snake"}));
    return resp.status(200).send({
      data: headJsons,
    });
  },

  opts: {
    schema: {},
  },
};
