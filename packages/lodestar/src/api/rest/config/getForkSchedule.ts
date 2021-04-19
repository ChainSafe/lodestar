import {ApiController} from "../types";

export const getForkSchedule: ApiController = {
  url: "/fork_schedule",
  method: "GET",
  id: "getForkSchedule",

  handler: async function () {
    const forkSchedule = await this.api.config.getForkSchedule();
    return {
      data: forkSchedule.map((fork) => this.config.types.phase0.Fork.toJson(fork, {case: "snake"})),
    };
  },
};
