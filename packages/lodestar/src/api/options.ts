import rpcDefaultOptions, {IRpcOptions} from "./rpc/options";
import restApiDefaultOptions, {IRestApiOptions, RestOptions} from "./rest/options";
import {IConfigurationModule} from "../util/config";


export interface IApiOptions {
  rpc: IRpcOptions;
  rest: IRestApiOptions;
}

export default {
  rpc: rpcDefaultOptions,
  rest: restApiDefaultOptions
};

export const ApiOptions: IConfigurationModule = {
  name: "api",
  description: "Options related to api interfaces",
  fields: [
    RestOptions,
  ]
};