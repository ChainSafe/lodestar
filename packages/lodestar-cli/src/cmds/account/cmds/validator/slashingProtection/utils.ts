import {Root} from "@chainsafe/lodestar-types";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {SlashingProtection} from "@chainsafe/lodestar-validator";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {getValidatorPaths} from "../../../../validator/paths";
import {getBeaconConfigFromArgs} from "../../../../../config";
import {IGlobalArgs} from "../../../../../options";

export function getSlashingProtection(args: IGlobalArgs): SlashingProtection {
  const validatorPaths = getValidatorPaths(args);
  const dbPath = validatorPaths.validatorsDbDir;
  const config = getBeaconConfigFromArgs(args);
  const logger = new WinstonLogger();
  return new SlashingProtection({
    config: config,
    controller: new LevelDbController({name: dbPath}, {logger}),
  });
}

export function getGenesisValidatorsRoot(args): Root {
  const genesisValidatorsRoot = testnet.getGenesisState().genesis_validators_root;
  return genesisValidatorsRoot;
}
