import {ApiController} from "../types";

export const getDepositContract: ApiController = {
  url: "/deposit_contract",

  handler: async function (req, resp) {
    const depositContract = await this.api.config.getDepositContract();
    return resp.status(200).send({
      data: this.config.types.Contract.toJson(depositContract, {case: "snake"}),
    });
  },

  opts: {
    schema: {},
  },
};
