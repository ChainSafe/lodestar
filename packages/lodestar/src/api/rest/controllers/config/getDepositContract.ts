import {ApiController} from "../types";

export const getDepositContract: ApiController = {
  url: "/deposit_contract",

  handler: async function (req, resp) {
    const depositContract = this.api.config.getDepositContract();
    this.config.params.DEPOSIT_CONTRACT_ADDRESS.toJSON();
    return resp.status(200).send({
      data: config.types.Contract.toJson(depositContract, {case: "snake"}),
    });
  },

  opts: {
    schema: {},
  },
};
