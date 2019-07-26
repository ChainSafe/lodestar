import {DatabaseOptions, IDatabaseOptions} from "../db/options";
import {RpcClient} from "./rpc";
import {Keypair} from "@chainsafe/bls-js/lib/keypair";
import {IConfigurationModule} from "../util/config";
import {IValidatorDB} from "../db/api";
import {PrivateKey} from "@chainsafe/bls-js/lib/privateKey";
import {ILoggingOptions} from "../logger/option";
import {LoggingOptions} from "../logger/option";

export interface IValidatorOptions {
  db: IDatabaseOptions;
  dbInstance?: IValidatorDB;
  rpc: string;
  rpcInstance?: RpcClient;
  keypair: Keypair;
  keystore?: string;
  loggingOptions?: ILoggingOptions;
}

export const ValidatorOptions: IConfigurationModule = {
  name: 'validator',
  fields: [
    DatabaseOptions,
    {
      name: "syncRpc.ts",
      type: String,
      configurable: true,
      description: "Url to beacon node ws rpc",
      cli: {
        flag: "rpcWsUrl"
      }
    },
    {
      name: "keypair",
      type: Keypair,
      description: "Private key",
      configurable: true,
      process: (privateKey) => {
        console.log(privateKey);
        const pk = PrivateKey.fromHexString(privateKey);
        return new Keypair(pk);
      },
      cli: {
        flag: "validatorPrivateKey"
      }
    },
    {
      name: "keystore",
      type: String,
      description: "Path to keystore file",
      configurable: true,
      cli: {
        flag: "validatorKeystore"
      }
    },
    LoggingOptions
  ]
};

const config: IValidatorOptions = {
  db: {
    name: "./validator-db"
  },
  rpc: "http://localhost:8545",
  keypair: Keypair.generate(),
  keystore: null
};

export default config;
