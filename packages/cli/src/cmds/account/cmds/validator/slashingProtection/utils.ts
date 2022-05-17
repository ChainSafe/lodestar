import {Root} from "@chainsafe/lodestar-types";
import {getClient} from "@chainsafe/lodestar-api";
import {SlashingProtection} from "@chainsafe/lodestar-validator";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {YargsError} from "../../../../../util/index.js";
import {IGlobalArgs} from "../../../../../options/index.js";
import {getValidatorPaths} from "../../../../validator/paths.js";
import {getBeaconConfigFromArgs} from "../../../../../config/index.js";
import {ISlashingProtectionArgs} from "./options.js";
import {errorLogger} from "../../../../../util/logger.js";

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
  const api = getClient({baseUrl: server}, {config});
  const genesis = await api.beacon.getGenesis();

  if (genesis !== undefined) {
    return genesis.data.genesisValidatorsRoot;
  } else {
    if (args.force) {
      return Buffer.alloc(32, 0);
    } else {
      throw new YargsError(`Can't get genesisValidatorsRoot from Beacon node at ${server}`);
    }
  }
}
