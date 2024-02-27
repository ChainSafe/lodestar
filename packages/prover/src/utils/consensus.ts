import {Api} from "@lodestar/api/beacon";
import {allForks, Bytes32, capella} from "@lodestar/types";
import {GenesisData, Lightclient} from "@lodestar/light-client";
import {ApiError} from "@lodestar/api";
import {Logger} from "@lodestar/utils";
import {MAX_PAYLOAD_HISTORY} from "../constants.js";
import {hexToBuffer} from "./conversion.js";

export async function fetchNearestBlock(
  api: Api,
  slot: number,
  direction: "up" | "down" = "down"
): Promise<capella.SignedBeaconBlock> {
  const res = await api.beacon.getBlockV2(slot);

  if (res.ok) return res.response.data as capella.SignedBeaconBlock;

  if (!res.ok && res.error.code === 404) {
    return fetchNearestBlock(api, direction === "down" ? slot - 1 : slot + 1);
  }

  throw new Error(`Can not fetch nearest block for slot=${slot}`);
}

export async function getUnFinalizedRangeForPayloads(lightClient: Lightclient): Promise<{start: number; end: number}> {
  const headSlot = lightClient.getHead().beacon.slot;
  const finalizeSlot = lightClient.getFinalized().beacon.slot;
  const endSlot = headSlot - MAX_PAYLOAD_HISTORY;

  return {
    start: headSlot,
    end: endSlot < finalizeSlot ? finalizeSlot : endSlot,
  };
}

export async function getExecutionPayloads({
  api,
  startSlot,
  endSlot,
  logger,
}: {
  api: Api;
  startSlot: number;
  endSlot: number;
  logger: Logger;
}): Promise<Record<number, allForks.ExecutionPayload>> {
  [startSlot, endSlot] = [Math.min(startSlot, endSlot), Math.max(startSlot, endSlot)];
  if (startSlot === endSlot) {
    logger.debug("Fetching EL payload", {slot: startSlot});
  } else {
    logger.debug("Fetching EL payloads", {startSlot, endSlot});
  }

  const payloads: Record<number, allForks.ExecutionPayload> = {};

  let slot = endSlot;
  let block = await fetchNearestBlock(api, slot, "down");
  payloads[block.message.slot] = block.message.body.executionPayload;
  slot = block.message.slot - 1;

  while (slot >= startSlot) {
    const previousBlock = await fetchNearestBlock(api, block.message.slot - 1, "down");

    if (block.message.body.executionPayload.parentHash === previousBlock.message.body.executionPayload.blockHash) {
      payloads[block.message.slot] = block.message.body.executionPayload;
    }

    slot = block.message.slot - 1;
    block = previousBlock;
  }

  return payloads;
}

export async function getExecutionPayloadForBlockNumber(
  api: Api,
  startSlot: number,
  blockNumber: number
): Promise<Record<number, allForks.ExecutionPayload>> {
  const payloads: Record<number, allForks.ExecutionPayload> = {};

  let block = await fetchNearestBlock(api, startSlot, "down");
  payloads[block.message.slot] = block.message.body.executionPayload;

  while (payloads[block.message.slot].blockNumber !== blockNumber) {
    const previousBlock = await fetchNearestBlock(api, block.message.slot - 1, "down");
    block = previousBlock;
    payloads[block.message.slot] = block.message.body.executionPayload;
  }

  return payloads;
}

export async function getGenesisData(api: Pick<Api, "beacon">): Promise<GenesisData> {
  const res = await api.beacon.getGenesis();
  ApiError.assert(res);

  return {
    genesisTime: Number(res.response.data.genesisTime),
    genesisValidatorsRoot: res.response.data.genesisValidatorsRoot,
  };
}

export async function getSyncCheckpoint(api: Pick<Api, "beacon">, checkpoint?: string): Promise<Bytes32> {
  let syncCheckpoint: Bytes32 | undefined = checkpoint ? hexToBuffer(checkpoint) : undefined;

  if (syncCheckpoint && syncCheckpoint.byteLength !== 32) {
    throw Error(`Checkpoint root must be 32 bytes. length=${syncCheckpoint.byteLength}`);
  }

  if (!syncCheckpoint) {
    const res = await api.beacon.getStateFinalityCheckpoints("head");
    ApiError.assert(res);
    syncCheckpoint = res.response.data.finalized.root;
  }

  return syncCheckpoint;
}
