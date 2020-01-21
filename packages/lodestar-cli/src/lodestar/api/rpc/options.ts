import {processApiNamespaces} from "../utils";
import {booleanOption, IConfigurationModule} from "../../util/config";

export const RpcOptions: IConfigurationModule = {
  name: "rpc",
  fields: [
    booleanOption("enabled", "--rpc"),
    {
      name: "api",
      type: "string",
      process: processApiNamespaces,
      configurable: true,
      cli: {
        flag: "--rpc-api"
      }
    },
    {
      name: "host",
      type: "string",
      configurable: true,
      cli: {
        flag: "--rpc-host"
      }
    },
    {
      name: "port",
      type: "number",
      configurable: true,
      cli: {
        flag: "--rpc-port"
      }
    },
    {
      name: "cors",
      type: "string",
      configurable: true,
      cli: {
        flag: "--rpc-rest-cors"
      }
    }
  ]
};