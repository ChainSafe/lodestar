/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/naming-convention */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks} from "@chainsafe/lodestar-types";
import {Checkpoint} from "@chainsafe/lodestar-types/phase0";
import {ILogger, fromHex} from "@chainsafe/lodestar-utils";
import {TreeBacked} from "@chainsafe/ssz";
import got from "got";
import {IGlobalArgs} from "../options";
import {IBeaconArgs} from "./beacon/options";

// TODO put the real server names/IPs once we have them
export enum WeakSubjectivityServers {
  mainnet = "http://localhost:8081",
  prater = "http://localhost:8081",
  pyrmont = "http://localhost:8081",
  dev = "http://localhost:8081",
  oonoonba = "http://localhost:8081",
}

export type WeakSubjectivityData = {
  state: TreeBacked<allForks.BeaconState>;
  checkpoint: Checkpoint;
};

type WSResponse = {
  current_epoch: number;
  ws_checkpoint: string;
  ws_period: number;
  is_safe: boolean;
  ws_state: {
    data: {
      slot: number;
    };
  };
};

export async function getWeakSubjectivityData(
  config: IBeaconConfig,
  args: IBeaconArgs & IGlobalArgs,
  server: string,
  logger: ILogger
): Promise<WeakSubjectivityData> {
  logger.info("Fetching weak subjectivity state from ChainSafe at " + server);
  const response = await got(server, {searchParams: {checkpoint: args.weakSubjectivityCheckpoint}});
  const responseBody = JSON.parse(response.body) as WSResponse;
  if (!responseBody.ws_state) {
    throw new Error("Unexpected data from weak subjectivity server.  Missing ws_state.");
  }
  const data = responseBody.ws_state.data;
  const state = config.getForkTypes(data.slot).BeaconState.createTreeBackedFromJson(data, {case: "snake"});
  if (!state) {
    throw new Error("Weak subjectivity state not found for network " + args.network);
  }
  const [checkpointRoot, checkpointEpoch] = (args.weakSubjectivityCheckpoint || responseBody.ws_checkpoint).split(":");
  console.log("checkpoint data: ", checkpointRoot, checkpointEpoch);
  const checkpoint = {root: fromHex(checkpointRoot), epoch: parseInt(checkpointEpoch)};
  return {state, checkpoint};
}
