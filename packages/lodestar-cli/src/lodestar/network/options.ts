import {IConfigurationModule} from "../util/config";

export const NetworkOptions: IConfigurationModule = {
  name: "network",
  fields: [
    {
      name: "maxPeers",
      type: "number",
      configurable: true,
      process: (input) => {
        return parseInt(input);
      },
      cli: {
        flag: "maxPeers"
      }
    },
    {
      name: "bootnodes",
      type: [String],
      configurable: true,
      process: (input: string) => {
        return input.split(",").map((input) => input.trim());
      },
      cli: {
        flag: "bootnodes"
      }
    },
    {
      name: "multiaddrs",
      type: [String],
      configurable: true,
      process: (input: string) => {
        return input.split(",").map((input) => input.trim());
      },
      cli: {
        flag: "multiaddrs"
      }
    },
  ]
};
