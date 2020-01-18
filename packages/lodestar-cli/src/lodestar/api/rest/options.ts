import {booleanOption, IConfigurationModule} from "../../util/config";
import {processApiNamespaces} from "../utils";

export const RestOptions: IConfigurationModule = {
  name: "rest",
  description: "Options to configure rest api server",
  fields: [
    booleanOption("enabled", "--rest"),
    {
      name: "api",
      type: "string",
      process: processApiNamespaces,
      configurable: true,
      cli: {
        flag: "--rest-api"
      }
    },
    {
      name: "host",
      type: "string",
      configurable: true,
      cli: {
        flag: "--rest-host"
      }
    },
    {
      name: "port",
      type: "number",
      configurable: true,
      cli: {
        flag: "--rest-port"
      }
    },
    {
      name: "cors",
      type: "string",
      configurable: true,
      cli: {
        flag: "--rest-cors"
      }
    }
  ]
};