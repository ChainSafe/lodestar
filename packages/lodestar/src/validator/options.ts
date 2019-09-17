import {IDatabaseOptions} from "../db/options";
import {RpcClient} from "./rpc";
import {ILoggerOptions, LogLevel, defaultLogLevel} from "../logger";
import {Keypair} from "@chainsafe/bls/lib/keypair";
import {IConfigurationModule} from "../util/config";
import {IValidatorDB} from "../db/api";
import {PrivateKey} from "@chainsafe/bls/lib/privateKey";

export interface IValidatorOptions {
  db: IDatabaseOptions;
  dbInstance?: IValidatorDB;
  restUrl: string;
  rpc: string;
  rpcInstance?: RpcClient;
  keypair: Keypair;
  keystore?: string;
  logger: ILoggerOptions;
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
    }
  ]
};

const config: IValidatorOptions = {
  db: {
    name: "./validator-db"
  },
  restUrl: "",
  rpc: "http://localhost:8545",
  keypair: Keypair.generate(),
  keystore: null,
  logger: {
    level: LogLevel[defaultLogLevel],
    module: "validator",
  },
};

export default config;
