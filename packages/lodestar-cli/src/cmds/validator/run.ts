import fs from "fs";
import process from "process";
import {Arguments} from "yargs";
import {initBLS} from "@chainsafe/bls";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {join} from "path";
import {IValidatorCliOptions} from "./options";
import {ApiClientOverRest} from "@chainsafe/lodestar-validator/lib/api/impl/rest/apiClient";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Validator} from "@chainsafe/lodestar-validator";
import {LevelDbController, ValidatorDB} from "@chainsafe/lodestar/lib/db";
import {unlockDirKeypairs} from "../account/utils/unlockKeypair";
import {getBeaconConfig} from "../../util/config";

/**
 * Run a validator client
 */
export async function run(options: Arguments<IValidatorCliOptions>): Promise<void> {
  const {datadir, server, spec, validatorsDir, secretsDir} = options;
  
  await initBLS();

  const config = getBeaconConfig(spec);

  const logger = new WinstonLogger();

  const validatorKeypairs = unlockDirKeypairs({keystoresDir: validatorsDir, secretsDir});
  logger.info(`Decrypted ${validatorKeypairs.length} validator keystores`);

  const validators: Validator[] = validatorKeypairs.map((keypair): Validator => {
    const pubKey = keypair.publicKey.toHexString();
    const dbPath = join(datadir, "validators", pubKey);
    fs.mkdirSync(dbPath, {recursive: true});
    
    const api = new ApiClientOverRest(config, server, logger);
    const childLogger = logger.child({module: `Validator ${pubKey}`, level: logger.level}) as ILogger;

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
