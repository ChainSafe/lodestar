import {Root} from "@chainsafe/lodestar-types";
import {LogLevel, WinstonLogger} from "@chainsafe/lodestar-utils";
import {SlashingProtection} from "@chainsafe/lodestar-validator";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {ApiClientOverRest} from "@chainsafe/lodestar-validator/lib/api/impl/rest/apiClient";
import {getValidatorPaths} from "../../../../validator/paths";
import {IValidatorCliArgs} from "../../../../validator/options";
import {getBeaconConfigFromArgs} from "../../../../../config";
import {IGlobalArgs} from "../../../../../options";

export function getSlashingProtection(args: IGlobalArgs): SlashingProtection {
  const validatorPaths = getValidatorPaths(args);
  const dbPath = validatorPaths.validatorsDbDir;
  const config = getBeaconConfigFromArgs(args);
  const logger = new WinstonLogger({level: LogLevel.error});
  return new SlashingProtection({
    config: config,
    controller: new LevelDbController({name: dbPath}, {logger}),
  });
}

export async function getGenesisValidatorsRoot(args: IGlobalArgs & Pick<IValidatorCliArgs, "server">): Promise<Root> {
  const server = args.server;

  // state.genesisValidatorsRoot
  const config = getBeaconConfigFromArgs(args);
  const logger = new WinstonLogger({level: LogLevel.error});

  const api = new ApiClientOverRest(config, server, logger);
  const genesis = await api.beacon.getGenesis();
  if (!genesis) {
    throw Error(`Beacon node has not genesis ${server}`);
  }

  return genesis.genesisValidatorsRoot;
}
