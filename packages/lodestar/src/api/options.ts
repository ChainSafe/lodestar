import rpcDefaultOptions, {IRpcOptions} from "./rpc/options";
import restApiDefaultOptions, {IRestApiOptions} from "./rest/options";


export interface IApiOptions {
  rpc: IRpcOptions;
  rest: IRestApiOptions;
}

export default {
  rpc: rpcDefaultOptions,
  rest: restApiDefaultOptions
};
