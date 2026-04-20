import {ForkPostGloas, isForkPostGloas} from "@lodestar/params";
import {RootHex, SignedBeaconBlock} from "@lodestar/types";
import {IBeaconChain} from "../../interface.js";
import {PayloadEnvelopeInput} from "./payloadEnvelopeInput.js";

/**
 * Rebuild a missing PayloadEnvelopeInput for an already-imported block.
 *
 * This keeps the seen cache disposable: callers can recover the bid metadata needed for
 * late payload envelopes / data columns after the cache entry was pruned.
 */
export async function getOrRecoverPayloadEnvelopeInput(
  chain: IBeaconChain,
  blockRootHex: RootHex
): Promise<PayloadEnvelopeInput | undefined> {
  const cachedInput = chain.seenPayloadEnvelopeInputCache.get(blockRootHex);
  if (cachedInput) {
    return cachedInput;
  }

  const blockResult = await chain.getBlockByRoot(blockRootHex);
  if (!blockResult) {
    return undefined;
  }

  const forkName = chain.config.getForkName(blockResult.block.message.slot);
  if (!isForkPostGloas(forkName)) {
    return undefined;
  }

  try {
    return chain.seenPayloadEnvelopeInputCache.add({
      blockRootHex,
      block: blockResult.block as SignedBeaconBlock<ForkPostGloas>,
      forkName,
      sampledColumns: chain.custodyConfig.sampledColumns,
      custodyColumns: chain.custodyConfig.custodyColumns,
      timeCreatedSec: Date.now() / 1000,
    });
  } catch (e) {
    const recoveredInput = chain.seenPayloadEnvelopeInputCache.get(blockRootHex);
    if (recoveredInput) {
      return recoveredInput;
    }
    throw e;
  }
}
