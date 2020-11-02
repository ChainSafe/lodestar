import fs from "fs";
import {initBLS} from "@chainsafe/bls";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {ApiClientOverRest} from "@chainsafe/lodestar-validator/lib/api/impl/rest/apiClient";
import {Validator, SlashingProtection} from "@chainsafe/lodestar-validator";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {getBeaconConfigFromArgs} from "../../config";
import {IGlobalArgs} from "../../options";
import {YargsError, getDefaultGraffiti} from "../../util";
import {ValidatorDirManager} from "../../validatorDir";
import {getAccountPaths} from "../account/paths";
import {getValidatorPaths} from "./paths";
import {IValidatorCliArgs} from "./options";
import {onGracefulShutdown} from "../../util/process";

/**
 * Run a validator client
 */
export async function validatorHandler(args: IValidatorCliArgs & IGlobalArgs): Promise<void> {
  await initBLS();

  const server = args.server;
  const force = args.force;
  const graffiti = args.graffiti || getDefaultGraffiti();
  const accountPaths = getAccountPaths(args);
  const validatorPaths = getValidatorPaths(args);
  const config = getBeaconConfigFromArgs(args);

  const logger = new WinstonLogger();

  const validatorDirManager = new ValidatorDirManager(accountPaths);
  const keypairs = await validatorDirManager.decryptAllValidators({force});

  if (keypairs.length === 0) throw new YargsError("No validator keystores found");
  logger.info(`Decrypted ${keypairs.length} validator keystores`);

  const dbPath = validatorPaths.validatorsDbDir;
  fs.mkdirSync(dbPath, {recursive: true});

  const api = new ApiClientOverRest(config, server, logger);

  const validator = new Validator({
    config,
    slashingProtection: new SlashingProtection({
      config: config,
      controller: new LevelDbController({name: dbPath}, {logger}),
    }),
    api,
    logger,
    keypairs,
    graffiti,
  });

  onGracefulShutdown(async () => {
    await validator.stop();
  }, logger.info.bind(logger));

  await validator.start();
}
