import {Root} from "@lodestar/types";
import {ApiError, getClient} from "@lodestar/api";
import {fromHex, Logger} from "@lodestar/utils";
import {genesisData, NetworkName} from "@lodestar/config/networks";
import {SlashingProtection, MetaDataRepository} from "@lodestar/validator";
import {DatabaseApiOptions, LevelDbController} from "@lodestar/db";
import {GlobalArgs} from "../../../options/index.js";
import {getValidatorPaths} from "../paths.js";
import {getBeaconConfigFromArgs} from "../../../config/index.js";
import {ISlashingProtectionArgs} from "./options.js";

/**
 * Returns a new SlashingProtection object instance based on global args.
 */
export function getSlashingProtection(
  args: GlobalArgs,
  network: string,
  logger: Logger
): {slashingProtection: SlashingProtection; metadata: MetaDataRepository} {
  const validatorPaths = getValidatorPaths(args, network);
  const dbPath = validatorPaths.validatorsDbDir;
  const {config} = getBeaconConfigFromArgs(args);

  const dbOpts: DatabaseApiOptions = {
    config,
    controller: new LevelDbController({name: dbPath}, {logger}),
  };

  return {
    slashingProtection: new SlashingProtection(dbOpts),
    metadata: new MetaDataRepository(dbOpts),
  };
}

/**
 * Returns genesisValidatorsRoot from validator API client.
 */
export async function getGenesisValidatorsRoot(args: GlobalArgs & ISlashingProtectionArgs): Promise<Root> {
  const server = args.beaconNodes[0];

  const networkGenesis = genesisData[args.network as NetworkName];
  if (networkGenesis !== undefined) {
    return fromHex(networkGenesis.genesisValidatorsRoot);
  }

  const {config} = getBeaconConfigFromArgs(args);
  const api = getClient({baseUrl: server}, {config});
  const genesis = await api.beacon.getGenesis();

  try {
    ApiError.assert(genesis, "Can not fetch genesis data");
  } catch (e) {
    if (args.force) {
      return Buffer.alloc(32, 0);
    }
    throw e;
  }

  return genesis.response.data.genesisValidatorsRoot;
}
