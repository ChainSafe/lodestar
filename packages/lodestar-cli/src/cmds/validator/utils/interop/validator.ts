import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Validator} from "@chainsafe/lodestar-validator";
import {IApiClient, interopKeypair} from "@chainsafe/lodestar-validator/lib";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {LevelDbController, ValidatorDB} from "@chainsafe/lodestar/lib/db";
import {join} from "path";
import {mkdirSync} from "fs";

export interface IValidatorModules {
  api: IApiClient;
  logger: ILogger;
}

export function getInteropValidator(
  config: IBeaconConfig, rootDir: string, modules: IValidatorModules, index: number
): Validator {
  const logger= modules.logger.child({module: "Validator #" + index, level: modules.logger.level}) as ILogger;
  const dbPath = join(rootDir, "validators", index.toString());
  mkdirSync(dbPath, {recursive: true});
  return new Validator({
    config,
    db: new ValidatorDB({
      config: config,
      controller: new LevelDbController({
        name: dbPath
      }, {logger})
    }),
    api: modules.api,
    logger: logger,
    keypair: new Keypair(PrivateKey.fromBytes(interopKeypair(index).privkey))
  });
}
