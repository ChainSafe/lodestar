import {Root, Slot} from "@chainsafe/lodestar-types";
import {ApiController} from "../../types";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const getBlockHeaders: ApiController<{slot?: string | number; parent_root?: string}> = {
  url: "/headers",
  method: "GET",

  handler: async function (req, resp) {
    let slot: Slot | undefined;
    if (req.query.slot || req.query.slot === 0) {
      slot = this.config.types.Slot.fromJson(req.query.slot);
    }
    let parentRoot: Root | undefined;
    if (req.query.parent_root) {
      parentRoot = this.config.types.Root.fromJson(req.query.parent_root);
    }
    const data = await this.api.beacon.blocks.getBlockHeaders({slot, parentRoot});
    resp.status(200).send({
      data: data.map((item) => this.config.types.phase0.SignedBeaconHeaderResponse.toJson(item, {case: "snake"})),
    });
  },

  opts: {
    schema: {
      querystring: {
        type: "object",
        required: [],
        properties: {
          slot: {
            type: "number",
            minimum: 0,
          },
          // eslint-disable-next-line @typescript-eslint/naming-convention
          parent_root: {
            type: "string",
          },
        },
      },
    },
  },
};
