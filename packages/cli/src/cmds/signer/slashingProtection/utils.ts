import {NetworkName, genesisData} from "@lodestar/config/networks";
import {LevelDbController} from "@lodestar/db/controller/level";
import {Root} from "@lodestar/types";
import {Logger, fromHex} from "@lodestar/utils";
import {MetaDataRepository, SlashingProtection} from "@lodestar/validator";
import {GlobalArgs} from "../../../options/index.js";
import {mkdir} from "../../../util/index.js";
import {SignerPaths, getSignerPaths} from "../paths.js";

export async function getSlashingProtection(
  args: Partial<SignerPaths> & GlobalArgs,
  network: string,
  logger: Logger
): Promise<{db: LevelDbController; slashingProtection: SlashingProtection; metadata: MetaDataRepository}> {
  const {signerDbDir} = getSignerPaths(args, network);
  mkdir(signerDbDir);

  const db = await LevelDbController.create({name: signerDbDir}, {logger});

  return {
    db,
    slashingProtection: new SlashingProtection(db),
    metadata: new MetaDataRepository(db),
  };
}

/**
 * The signer does not connect to a beacon node, the genesis validators root is only known upfront for known networks
 */
export function getKnownGenesisValidatorsRoot(network: string): Root | null {
  const networkGenesis = genesisData[network as NetworkName];
  return networkGenesis !== undefined ? fromHex(networkGenesis.genesisValidatorsRoot) : null;
}
