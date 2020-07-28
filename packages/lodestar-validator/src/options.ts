import {IApiClient} from "./api";
import {Keypair} from "@chainsafe/bls/lib/keypair";
import {IValidatorDB} from "./db/interface";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export interface IValidatorOptions {
  db: IValidatorDB;
  config: IBeaconConfig;
  api: IApiClient | string;
  keypairs: Keypair[];
  logger: ILogger;
  graffiti?: string;
}
