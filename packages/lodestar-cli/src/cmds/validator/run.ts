import fs from "fs";
import process from "process";
import {Arguments} from "yargs";
import {initBLS} from "@chainsafe/bls";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {ApiClientOverRest} from "@chainsafe/lodestar-validator/lib/api/impl/rest/apiClient";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Validator} from "@chainsafe/lodestar-validator";
import {LevelDbController, ValidatorDB} from "@chainsafe/lodestar/lib/db";

import {YargsError, getDefaultGraffiti} from "../../util";
import {ValidatorDirManager} from "../../validatorDir";
import {getAccountPaths} from "../account/paths";
import {getValidatorPaths} from "./paths";
import {IValidatorCliOptions} from "./options";
import {getMergedIBeaconConfig} from "../../config/params";
import {initHandler as initCmd} from "../init/init";
import {IInitOptions} from "../init/options";

/**
 * Run a validator client
 */
export async function run(options: Arguments<IValidatorCliOptions>): Promise<void> {
  await initBLS();
  await initCmd(options as unknown as IInitOptions);

  const server = options.server;
  const force = options.force;
  const graffiti = options.graffiti || getDefaultGraffiti();
  const accountPaths = getAccountPaths(options);
  const validatorPaths = getValidatorPaths(options);
  const config = await getMergedIBeaconConfig(options.preset, options.paramsFile, options.params);

  const logger = new WinstonLogger();

  const validatorDirManager = new ValidatorDirManager(accountPaths);
  const validatorKeypairs = validatorDirManager.decryptAllValidators({force});

  if (validatorKeypairs.length === 0)
    throw new YargsError("No validator keystores found");
  logger.info(`Decrypted ${validatorKeypairs.length} validator keystores`);

  const validators: Validator[] = validatorKeypairs.map((keypair): Validator => {
    const pubkey = keypair.publicKey.toHexString();
    const loggerId = `Validator ${pubkey.slice(0, 10)}`;
    const dbPath = validatorPaths.validatorDbDir(pubkey);
    fs.mkdirSync(dbPath, {recursive: true});

    const api = new ApiClientOverRest(config, server, logger);
    const childLogger = logger.child({module: loggerId, level: logger.level}) as ILogger;

    return new Validator({
      config,
      db: new ValidatorDB({
        config: config,
        controller: new LevelDbController({
          name: dbPath
        }, {logger: childLogger})
      }),
      api,
      logger: childLogger,
      keypairs: [keypair],
      graffiti
    });
  });

  for (const validator of validators) {
    validator.start();
  }

  async function cleanup(): Promise<void> {
    logger.info("Stopping validators");
    await Promise.all(validators.map((v) => v.stop()));
    logger.info("Cleanup completed");
  }

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}
