import {BeaconParams} from "@chainsafe/lodestar-params";
import {ApiController} from "../types";

export const getSpec: ApiController = {
  url: "/spec",
  method: "GET",
  id: "getSpec",

  handler: async function () {
    const spec = await this.api.config.getSpec();
    return {
      data: BeaconParams.toJson(spec),
    };
  },
};
