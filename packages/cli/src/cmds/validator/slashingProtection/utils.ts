import {getClient} from "@lodestar/api";
import {NetworkName, genesisData} from "@lodestar/config/networks";
import {LevelDbController} from "@lodestar/db";
import {Root} from "@lodestar/types";
import {Logger, fromHex} from "@lodestar/utils";
import {MetaDataRepository, SlashingProtection} from "@lodestar/validator";
import {getBeaconConfigFromArgs} from "../../../config/index.js";
import {GlobalArgs} from "../../../options/index.js";
import {getValidatorPaths} from "../paths.js";
import {ISlashingProtectionArgs} from "./options.js";

/**
 * Returns a new SlashingProtection object instance based on global args.
 */
export async function getSlashingProtection(
  args: GlobalArgs,
  network: string,
  logger: Logger
): Promise<{slashingProtection: SlashingProtection; metadata: MetaDataRepository}> {
  const validatorPaths = getValidatorPaths(args, network);
  const dbPath = validatorPaths.validatorsDbDir;

  const db = await LevelDbController.create({name: dbPath}, {logger});

  return {
    slashingProtection: new SlashingProtection(db),
    metadata: new MetaDataRepository(db),
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
    genesis.assertOk();
  } catch (e) {
    if (args.force) {
      return Buffer.alloc(32, 0);
    }
    throw e;
  }

  return genesis.value().genesisValidatorsRoot;
}
