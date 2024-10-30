import {ApiClient} from "@lodestar/api/beacon";
import {GenesisData, Lightclient} from "@lodestar/light-client";
import {Bytes32, ExecutionPayload, capella} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {MAX_PAYLOAD_HISTORY} from "../constants.js";
import {hexToBuffer} from "./conversion.js";

export async function fetchBlock(api: ApiClient, slot: number): Promise<capella.SignedBeaconBlock | undefined> {
  const res = await api.beacon.getBlockV2({blockId: slot});

  if (res.ok) return res.value() as capella.SignedBeaconBlock;
  return;
}

export async function fetchNearestBlock(
  api: ApiClient,
  slot: number,
  direction: "up" | "down" = "down"
): Promise<capella.SignedBeaconBlock> {
  const res = await api.beacon.getBlockV2({blockId: slot});

  if (res.ok) return res.value() as capella.SignedBeaconBlock;

  if (!res.ok && res.status === 404) {
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
  api: ApiClient;
  startSlot: number;
  endSlot: number;
  logger: Logger;
}): Promise<Map<number, ExecutionPayload>> {
  [startSlot, endSlot] = [Math.min(startSlot, endSlot), Math.max(startSlot, endSlot)];
  if (startSlot === endSlot) {
    logger.debug("Fetching EL payload", {slot: startSlot});
  } else {
    logger.debug("Fetching EL payloads", {startSlot, endSlot});
  }

  const payloads = new Map<number, ExecutionPayload>();

  let slot = endSlot;
  let block = await fetchNearestBlock(api, slot);
  payloads.set(block.message.slot, block.message.body.executionPayload);
  slot = block.message.slot - 1;

  while (slot >= startSlot) {
    const previousBlock = await fetchNearestBlock(api, block.message.slot - 1);

    if (block.message.body.executionPayload.parentHash === previousBlock.message.body.executionPayload.blockHash) {
      payloads.set(block.message.slot, block.message.body.executionPayload);
    }

    slot = block.message.slot - 1;
    block = previousBlock;
  }

  return payloads;
}

export async function getExecutionPayloadForBlockNumber(
  api: ApiClient,
  startSlot: number,
  blockNumber: number
): Promise<Map<number, ExecutionPayload>> {
  const payloads = new Map<number, ExecutionPayload>();

  let block = await fetchNearestBlock(api, startSlot);
  payloads.set(block.message.slot, block.message.body.executionPayload);

  while (payloads.get(block.message.slot)?.blockNumber !== blockNumber) {
    const previousBlock = await fetchNearestBlock(api, block.message.slot - 1);
    block = previousBlock;
    payloads.set(block.message.slot, block.message.body.executionPayload);
  }

  return payloads;
}

export async function getGenesisData(api: Pick<ApiClient, "beacon">): Promise<GenesisData> {
  const {genesisTime, genesisValidatorsRoot} = (await api.beacon.getGenesis()).value();

  return {
    genesisTime,
    genesisValidatorsRoot,
  };
}

export async function getSyncCheckpoint(api: Pick<ApiClient, "beacon">, checkpoint?: string): Promise<Bytes32> {
  let syncCheckpoint: Bytes32 | undefined = checkpoint ? hexToBuffer(checkpoint) : undefined;

  if (syncCheckpoint && syncCheckpoint.byteLength !== 32) {
    throw Error(`Checkpoint root must be 32 bytes. length=${syncCheckpoint.byteLength}`);
  }

  if (!syncCheckpoint) {
    const res = await api.beacon.getStateFinalityCheckpoints({stateId: "head"});
    syncCheckpoint = res.value().finalized.root;
  }

  return syncCheckpoint;
}
