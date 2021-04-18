import {ApiController} from "../types";

export const getSyncingStatus: ApiController = {
  url: "/syncing",
  method: "GET",
  id: "getSyncingStatus",

  handler: async function () {
    const status = await this.api.node.getSyncingStatus();
    return {
      data: this.config.types.phase0.SyncingStatus.toJson(status, {case: "snake"}),
    };
  },
};
