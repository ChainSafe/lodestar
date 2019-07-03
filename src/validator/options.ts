import {IDatabaseOptions} from "../db/options";
import {ITransportOption} from "../rpc/options";
import {RpcClient} from "./rpc";
import {Keypair} from "@chainsafe/bls-js/lib/keypair";
import {TransportType} from "../rpc/transport";
import {IConfigurationModule} from "../util/config";

export interface IValidatorOptions {
  db: IDatabaseOptions;
  rpc: ITransportOption;
  rpcInstance?: RpcClient;
  keypair: Keypair;
}

export const ValidatorOptions: IConfigurationModule = {
  name: 'validator',
  fields: [
    {
      name: "db",
      fields: [
        {
          name: "name",
          type: String,
          configurable: true,
          cli: {
            flag: "validatorDb"
          }
        }
      ]
    },
    {
      name: "keystore",
      type: String,
      configurable: true,
      cli: {
        flag: "validatorKeystore"
      }
    }
  ]
};

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
