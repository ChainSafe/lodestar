import {Root} from "@lodestar/types";
import {getClient} from "@lodestar/api";
import {fromHex} from "@lodestar/utils";
import {genesisData, NetworkName} from "@lodestar/config/networks";
import {SlashingProtection, MetaDataRepository} from "@lodestar/validator";
import {IDatabaseApiOptions, LevelDbController} from "@lodestar/db";
import {YargsError} from "../../../util/index.js";
import {IGlobalArgs} from "../../../options/index.js";
import {getValidatorPaths} from "../paths.js";
import {getBeaconConfigFromArgs} from "../../../config/index.js";
import {ISlashingProtectionArgs} from "./options.js";

/**
 * Returns a new SlashingProtection object instance based on global args.
 */
export function getSlashingProtection(
  args: IGlobalArgs,
  network: string
): {slashingProtection: SlashingProtection; metadata: MetaDataRepository} {
  const validatorPaths = getValidatorPaths(args, network);
  const dbPath = validatorPaths.validatorsDbDir;
  const {config} = getBeaconConfigFromArgs(args);

  const dbOpts: IDatabaseApiOptions = {
    config,
    controller: new LevelDbController({name: dbPath}, {}),
  };

  return {
    slashingProtection: new SlashingProtection(dbOpts),
    metadata: new MetaDataRepository(dbOpts),
  };
}

/**
 * Returns genesisValidatorsRoot from validator API client.
 */
export async function getGenesisValidatorsRoot(args: IGlobalArgs & ISlashingProtectionArgs): Promise<Root> {
  const server = args.beaconNodes[0];

  const networkGenesis = genesisData[args.network as NetworkName];
  if (networkGenesis !== undefined) {
    return fromHex(networkGenesis.genesisValidatorsRoot);
  }

  const {config} = getBeaconConfigFromArgs(args);
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
