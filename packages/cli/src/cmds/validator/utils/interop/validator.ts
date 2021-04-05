import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {Validator, SlashingProtection} from "@chainsafe/lodestar-validator";
import {IApiClient} from "@chainsafe/lodestar-validator/lib";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {join} from "path";
import {mkdirSync} from "fs";

export interface IValidatorModules {
  api: IApiClient;
  logger: ILogger;
}

export function getInteropValidator(
  config: IBeaconConfig,
  rootDir: string,
  modules: IValidatorModules,
  index: number
): Validator {
  const logger = modules.logger.child({module: "Validator #" + index});
  const dbPath = join(rootDir, "validators", index.toString());
  mkdirSync(dbPath, {recursive: true});
  const secretKey = interopSecretKey(index);
  return new Validator({
    config,
    slashingProtection: new SlashingProtection({
      config: config,
      controller: new LevelDbController({name: dbPath}, {logger}),
    }),
    api: modules.api,
    logger: logger,
    secretKeys: [secretKey],
  });
}
