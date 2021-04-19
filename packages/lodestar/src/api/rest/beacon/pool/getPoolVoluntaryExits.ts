import {ApiController} from "../../types";

export const getPoolVoluntaryExits: ApiController = {
  url: "/pool/voluntary_exits",
  method: "GET",
  id: "getPoolVoluntaryExits",

  handler: async function () {
    const exits = await this.api.beacon.pool.getVoluntaryExits();
    return {
      data: exits.map((exit) => this.config.types.phase0.SignedVoluntaryExit.toJson(exit, {case: "snake"})),
    };
  },
};
