import {IConfigurationModule} from "../util/config";

export const DatabaseOptions: IConfigurationModule = {
  name: "db",
  fields: [
    {
      name: "name",
      description: "Path to file database",
      configurable: true,
      type: String,
      cli: {
        flag: "db",
        short: "d"
      }
    }
  ]
};
