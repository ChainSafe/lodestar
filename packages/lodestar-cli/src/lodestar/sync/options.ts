import {IConfigurationModule} from "../util/config";

export const SyncOptions: IConfigurationModule = {
  name: "sync",
  fields: [
    {
      name: "minPeers",
      configurable: true,
      cli: {
        flag: "minPeers"
      },
      type: "number"
    }
  ]
};
