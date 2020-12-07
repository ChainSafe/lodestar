import {ListType} from "@chainsafe/ssz";
import {ApiController} from "../../types";

const MAX_FORKCHOICE_HEADS = 1000;

export const getHeads: ApiController = {
  url: "/beacon/heads",

  handler: async function (req, resp) {
    const heads = await this.api.debug.beacon.getHeads();
    if (!heads) {
      return resp.status(404).send();
    }
    const slotRootsType = new ListType({
      elementType: this.config.types.SlotRoot,
      limit: MAX_FORKCHOICE_HEADS,
    });
    return resp.status(200).send({
      data: slotRootsType.toJson(heads, {case: "snake"}),
    });
  },

  opts: {
    schema: {},
  },
};
