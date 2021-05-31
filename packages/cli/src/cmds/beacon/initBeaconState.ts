/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/naming-convention */

import {AbortSignal} from "abort-controller";

import {TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {fromHex, ILogger} from "@chainsafe/lodestar-utils";
import {allForks} from "@chainsafe/lodestar-types";
import {isWithinWeakSubjectivityPeriod} from "@chainsafe/lodestar-beacon-state-transition/lib/allForks/util/weakSubjectivity";
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
  const checkpointData = (args.weakSubjectivityCheckpoint || responseBody.ws_checkpoint).split(":");
  const checkpointRoot = checkpointData[0];
  const checkpointEpoch = checkpointData[1];
  const checkpoint = {root: fromHex(checkpointRoot), epoch: parseInt(checkpointEpoch)};

  // TODO: backfill blocks before calling isWithinWeakSubjectivityPeriod to get an accurate latestBlockHeader.stateRoot?  (it is always 0x0000...00 by default with fetched ws state)

  if (!isWithinWeakSubjectivityPeriod(config, state.genesisTime, state, checkpoint)) {
    throw new Error("Fetched weak subjectivity checkpoint not within weak subjectivity period.");
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
