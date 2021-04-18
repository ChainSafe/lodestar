import {ApiController} from "../types";

export const getDepositContract: ApiController = {
  url: "/deposit_contract",
  method: "GET",
  id: "getDepositContract",

  handler: async function () {
    const depositContract = await this.api.config.getDepositContract();
    return {
      data: this.config.types.phase0.Contract.toJson(depositContract, {case: "snake"}),
    };
  },
};
