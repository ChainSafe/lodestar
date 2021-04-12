import {ApiController} from "../types";

export const getForkSchedule: ApiController = {
  url: "/fork_schedule",
  method: "GET",

  handler: async function (req, resp) {
    const forkSchedule = await this.api.config.getForkSchedule();
    return resp.status(200).send({
      data: forkSchedule.map((fork) => {
        return this.config.types.phase0.Fork.toJson(fork, {case: "snake"});
      }),
    });
  },

  opts: {
    schema: {},
  },
};
