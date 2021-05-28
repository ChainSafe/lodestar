/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/naming-convention */

import {AbortSignal} from "abort-controller";

import {toHexString, TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {allForks} from "@chainsafe/lodestar-types";
import {
  IBeaconDb,
  Eth1Provider,
  IBeaconNodeOptions,
  initStateFromAnchorState,
  initStateFromDb,
  initStateFromEth1,
} from "@chainsafe/lodestar";
import {getStateTypeFromBytes} from "@chainsafe/lodestar/lib/util/multifork";
import {downloadOrLoadFile} from "../../util";
import {IBeaconArgs} from "./options";
import {defaultNetwork, IGlobalArgs} from "../../options/globalOptions";
import {getGenesisFileUrl} from "../../networks";
import {
  mainnetWeakSubjectivityServer,
  praterWeakSubjectivityServer,
  pyrmontWeakSubjectivityServer,
} from "../weakSubjectivityState";
import got from "got";

type WSResponse = {
  current_epoch: number;
  ws_checkpoint: string;
  ws_period: number;
  is_safe: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws_state: any;
};

async function initAndVerifyWeakSujectivityState(
  config: IBeaconConfig,
  db: IBeaconDb,
  args: IBeaconArgs & IGlobalArgs,
  server: string,
  logger: ILogger
): Promise<TreeBacked<allForks.BeaconState>> {
  logger.info("Fetching weak subjectivity state from ChainSafe at " + server);
  const response = await got(server, {searchParams: {checkpoint: args.weakSubjectivityCheckpoint}});
  const responseBody = JSON.parse(response.body) as WSResponse;
  const data = responseBody.ws_state.data;
  const state = config.getForkTypes(data.slot).BeaconState.createTreeBackedFromJson(data, {case: "snake"});
  if (!state) {
    throw new Error("Weak subjectivity state not found for network " + args.network);
  }
  const checkpoint = args.weakSubjectivityCheckpoint || responseBody.ws_checkpoint;
  const expectedRoot = checkpoint.split(":")[0];
  const actualRoot = toHexString(state.finalizedCheckpoint.root);
  // verify downloaded state against locally stored state root
  if (actualRoot !== expectedRoot) {
    throw new Error(
      `Fetched weak subjectivity checkpoint root does not match computed weak subjectivity checkpoint root.  Expected: ${expectedRoot}, Actual: ${actualRoot}`
    );
  }
  return await initStateFromAnchorState(config, db, logger, state);
}

/**
 * Initialize a beacon state, picking the strategy based on the `IBeaconArgs`
 *
 * State is initialized in one of three ways:
 * 1. restore from a file (possibly downloaded via URL)
 * 2. restore from db
 * 3. create from eth1
 */
export async function initBeaconState(
  options: IBeaconNodeOptions,
  args: IBeaconArgs & IGlobalArgs,
  config: IBeaconConfig,
  db: IBeaconDb,
  logger: ILogger,
  signal: AbortSignal
): Promise<TreeBacked<allForks.BeaconState>> {
  async function initFromFile(pathOrUrl: string): Promise<TreeBacked<allForks.BeaconState>> {
    const stateBytes = await downloadOrLoadFile(pathOrUrl);
    const anchorState = getStateTypeFromBytes(config, stateBytes).createTreeBackedFromBytes(stateBytes);
    return await initStateFromAnchorState(config, db, logger, anchorState as TreeBacked<allForks.BeaconState>);
  }

  const dbHasSomeState = (await db.stateArchive.lastKey()) != null;

  if (args.weakSubjectivityStateFile) {
    return await initFromFile(args.weakSubjectivityStateFile);
  } else if (dbHasSomeState) {
    return await initStateFromDb(config, db, logger);
  } else if (args.fetchChainSafeWeakSubjecitivtyState) {
    if (args.network === "mainnet") {
      return await initAndVerifyWeakSujectivityState(config, db, args, mainnetWeakSubjectivityServer, logger);
    } else if (args.network === "prater") {
      return await initAndVerifyWeakSujectivityState(config, db, args, praterWeakSubjectivityServer, logger);
    } else if (args.network === "pyrmont") {
      return await initAndVerifyWeakSujectivityState(config, db, args, pyrmontWeakSubjectivityServer, logger);
    } else {
      throw new Error("No matching network with weak subjectivity state.");
    }
  } else {
    const genesisStateFile = args.genesisStateFile || getGenesisFileUrl(args.network || defaultNetwork);
    if (genesisStateFile && !args.forceGenesis) {
      return await initFromFile(genesisStateFile);
    } else {
      return await initStateFromEth1(config, db, logger, new Eth1Provider(config, options.eth1), signal);
    }
  }
}
