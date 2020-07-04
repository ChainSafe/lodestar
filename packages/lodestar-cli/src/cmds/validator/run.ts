import fs from "fs";
import path from "path";
import process from "process";
import {Arguments} from "yargs";
import {initBLS} from "@chainsafe/bls";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {IValidatorCliArgs} from "./options";
import {ApiClientOverRest} from "@chainsafe/lodestar-validator/lib/api/impl/rest/apiClient";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Validator} from "@chainsafe/lodestar-validator";
import {LevelDbController, ValidatorDB} from "@chainsafe/lodestar/lib/db";
import {unlockDirKeypairs} from "../account/utils/unlockKeypair";
import {getBeaconConfig} from "../../util/config";
import {YargsError} from "../../util/errors";
import {resolveTildePath} from "../../util/paths";

/**
 * Run a validator client
 */
export async function run(options: Arguments<IValidatorCliArgs>): Promise<void> {
  const dbDir = options.dbDir;
  const server = options.server;
  const spec = options.chain.name;
  const keystoresDir = resolveTildePath(options.keystoresDir);
  const secretsDir = resolveTildePath(options.secretsDir);
  
  await initBLS();

  const config = getBeaconConfig(spec);

  const logger = new WinstonLogger();

  if (!fs.existsSync(keystoresDir))
    throw new YargsError(`keystoresDir ${keystoresDir} does not exist`);
  if (!fs.existsSync(secretsDir))
    throw new YargsError(`secretsDir ${secretsDir} does not exist`);

  const validatorKeypairs = unlockDirKeypairs({keystoresDir: keystoresDir, secretsDir});
  if (validatorKeypairs.length === 0)
    throw new YargsError(`There are no validator keystores in ${keystoresDir}`);
  logger.info(`Decrypted ${validatorKeypairs.length} validator keystores`);

  const validators: Validator[] = validatorKeypairs.map((keypair): Validator => {
    const pubkey = keypair.publicKey.toHexString();
    const loggerId = `Validator ${pubkey.slice(0, 10)}`;
    const dbPath = path.join(dbDir, pubkey);
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
      keypair
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
