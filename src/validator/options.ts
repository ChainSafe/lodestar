import {IDatabaseOptions} from "../db/options";
import {ITransportOption} from "../rpc/options";
import {RpcClient} from "./rpc";
import {Keypair} from "@chainsafe/bls-js/lib/keypair";
import {TransportType} from "../rpc/transport";
import {IConfigurationModule} from "../util/config";
import {IValidatorDB} from "../db/api";
import {PrivateKey} from "@chainsafe/bls-js/lib/privateKey";

export interface IValidatorOptions {
  db: IDatabaseOptions;
  dbInstance?: IValidatorDB;
  rpc: string;
  rpcInstance?: RpcClient;
  keypair: Keypair;
  keystore?: string;
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
      name: "rpc",
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
    }
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
