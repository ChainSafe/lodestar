import {ApiController} from "../../types";

export const getVoluntaryExits: ApiController = {
  url: "/pool/voluntary_exits",
  method: "GET",

  handler: async function () {
    const exits = await this.api.beacon.pool.getVoluntaryExits();
    return {
      data: exits.map((exit) => this.config.types.phase0.SignedVoluntaryExit.toJson(exit, {case: "snake"})),
    };
  },
};
