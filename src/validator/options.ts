import {IDatabaseOptions} from "../db/options";
import {ITransportOption} from "../rpc/options";
import {RpcClient} from "./rpc";
import {Keypair} from "@chainsafe/bls-js/lib/keypair";
import {TransportType} from "../rpc/transport";

export interface IValidatorOptions {
  db: IDatabaseOptions;
  rpc: ITransportOption
  rpcInstance?: RpcClient;
  keypair: Keypair;
}

const config: IValidatorOptions = {
  db: {
    name: "./validator-db"
  },
  rpc: {
    type: TransportType.WS,
    host: "http://localhost",
    port: 8545
  },
  keypair: null
};

export default config;
