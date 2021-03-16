import {Root} from "@chainsafe/lodestar-types";
import {SlashingProtection} from "@chainsafe/lodestar-validator";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {ApiClientOverRest} from "@chainsafe/lodestar-validator";
import {YargsError} from "../../../../../util";
import {IGlobalArgs} from "../../../../../options";
import {getValidatorPaths} from "../../../../validator/paths";
import {getBeaconConfigFromArgs} from "../../../../../config";
import {ISlashingProtectionArgs} from "./options";
import {errorLogger} from "../../../../../util/logger";

/**
 * Returns a new SlashingProtection object instance based on global args.
 */
export function getSlashingProtection(args: IGlobalArgs): SlashingProtection {
  const validatorPaths = getValidatorPaths(args);
  const dbPath = validatorPaths.validatorsDbDir;
  const config = getBeaconConfigFromArgs(args);
  const logger = errorLogger();
  return new SlashingProtection({
    config,
    controller: new LevelDbController({name: dbPath}, {logger}),
  });
}

/**
 * Returns genesisValidatorsRoot from validator API client.
 */
export async function getGenesisValidatorsRoot(args: IGlobalArgs & ISlashingProtectionArgs): Promise<Root> {
  const server = args.server;

  const config = getBeaconConfigFromArgs(args);
  const logger = errorLogger();
  const api = new ApiClientOverRest(config, server, logger);
  const genesis = await api.beacon.getGenesis();

  if (genesis) {
    return genesis.genesisValidatorsRoot;
  } else {
    if (args.force) {
      return Buffer.alloc(32, 0);
    } else {
      throw new YargsError(`Can't get genesisValidatorsRoot from Beacon node at ${server}`);
    }
  }
}
