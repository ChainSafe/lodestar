import {booleanOption, IConfigurationModule} from "../../util/config";
import {processApiNamespaces} from "../utils";

export const RestOptions: IConfigurationModule = {
  name: "rest",
  description: "Options to configure rest api server",
  fields: [
    booleanOption("enabled", "rest"),
    {
      name: "api",
      type: "string",
      process: processApiNamespaces,
      configurable: true,
      cli: {
        flag: "restApi"
      }
    },
    {
      name: "host",
      type: "string",
      configurable: true,
      cli: {
        flag: "restHost"
      }
    },
    {
      name: "port",
      type: "number",
      configurable: true,
      cli: {
        flag: "restPort"
      }
    },
    {
      name: "cors",
      type: "string",
      configurable: true,
      cli: {
        flag: "restCors"
      }
    }
  ]
};