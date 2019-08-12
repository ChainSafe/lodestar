import {ApiNamespace} from "./index";
import rpcDefaultOptions, {IRpcOptions} from "./rpc/options";


export interface IApiOptions {
    rpc: IRpcOptions,
    rest: {
        enabled: boolean,
        api: ApiNamespace[],
        host: string,
        cors: string,
        port: number,
    }
}

export default {
    rpc: rpcDefaultOptions,
    rest: {
        enabled: false,
        api: [ApiNamespace.BEACON, ApiNamespace.VALIDATOR],
        host: "127.0.0.1",
        port: 9596,
        cors: "*"
    }
}