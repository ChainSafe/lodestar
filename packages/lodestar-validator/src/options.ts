import {IApiClient} from "./api";
import {Keypair} from "@chainsafe/bls/lib/keypair";
import {IValidatorDB} from "./db/interface";
import {ILogger} from "./logger/interface";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

export interface IValidatorOptions {
  db: IValidatorDB;
  config: IBeaconConfig;
  api: IApiClient | string;
  keypair: Keypair;
  logger: ILogger;
}