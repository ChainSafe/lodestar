import {Api} from "@lodestar/api/beacon";
import {allForks, capella} from "@lodestar/types";
import {GenesisData} from "@lodestar/light-client";
import {ApiError} from "@lodestar/api";

export async function fetchNearestBlock(
  api: Api,
  slot: number,
  direction: "up" | "down" = "down"
): Promise<capella.SignedBeaconBlock> {
  const res = await api.beacon.getBlockV2(slot);

  if (res.ok) return res.response.data;

  if (!res.ok && res.error.code === 404) {
    return fetchNearestBlock(api, direction === "down" ? slot - 1 : slot + 1);
  }

  throw new Error(`Can not fetch nearest block for slot=${slot}`);
}

export async function getExecutionPayloads(
  api: Api,
  startSlot: number,
  endSlot: number
): Promise<Record<number, allForks.ExecutionPayload>> {
  [startSlot, endSlot] = [Math.min(startSlot, endSlot), Math.max(startSlot, endSlot)];

  const payloads: Record<number, allForks.ExecutionPayload> = {};

  let slot = endSlot;
  let block = (await fetchNearestBlock(api, slot, "down")) as capella.SignedBeaconBlock;
  payloads[block.message.slot] = block.message.body.executionPayload;

  while (slot >= startSlot) {
    const previousBlock = (await fetchNearestBlock(api, block.message.slot - 1, "down")) as capella.SignedBeaconBlock;

    if (block.message.body.executionPayload.parentHash === previousBlock.message.body.executionPayload.blockHash) {
      payloads[block.message.slot] = block.message.body.executionPayload;
    }

    slot = block.message.slot - 1;
    block = previousBlock;
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
