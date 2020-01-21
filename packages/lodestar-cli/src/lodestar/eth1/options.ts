import {IConfigurationModule} from "../util/config";

export const Eth1Options: IConfigurationModule = {
  name: "eth1",
  description: "Eth 1.x options",
  fields: [
    {
      name: "provider",
      fields: [
        {
          name: "url",
          description: "Url to eth1 node with enabled rpc api",
          type: String,
          configurable: true,
          cli: {
            flag: "eth1RpcUrl"
          }
        },
        {
          name: "network",
          description: "Eth1 network id",
          type: "number",
          configurable: true,
          cli: {
            flag: "networkId"
          }
        }
      ]
    },
    {
      name: "depositContract",
      fields: [
        {
          name: "deployedAt",
          description: "Block number at which contract is deployed",
          type: "number",
          configurable: true,
          cli: {
            flag: "depositContractBlockNum"
          }
        },
        {
          name: "address",
          description: "Address of deposit contract",
          type: String,
          configurable: true,
          cli: {
            flag: "depositContract"
          }
        }
      ]
    }
  ]
};
