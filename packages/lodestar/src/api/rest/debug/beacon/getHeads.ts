import {ApiController} from "../../types";

export const getHeads: ApiController = {
  url: "/beacon/heads",
  method: "GET",

  handler: async function () {
    const heads = await this.api.debug.beacon.getHeads();
    return {
      data: heads.map((head) => this.config.types.phase0.SlotRoot.toJson(head, {case: "snake"})),
    };
  },
};
