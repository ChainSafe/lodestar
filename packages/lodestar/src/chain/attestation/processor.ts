import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {toHexString} from "@chainsafe/ssz";
import {getAttestationPreState} from "../../network/gossip/utils";
// eslint-disable-next-line max-len
import {isValidIndexedAttestation} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block/isValidIndexedAttestation";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Attestation} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconChain} from "../interface";
import {IBeaconDb} from "../../db/api";

/**
 * Method expects valid attestation which is
 * going to be applied in forkchoice.
 */
export async function processAttestation(
  config: IBeaconConfig,
  chain: IBeaconChain,
  logger: ILogger,
  db: IBeaconDb,
  attestation: Attestation
): Promise<void> {
  const attestationHash = config.types.Attestation.hashTreeRoot(attestation);
  const target = attestation.data.target;
  try {
    //LMD vote must be consistent with FFG vote target
    const targetSlot = computeStartSlotAtEpoch(config, target.epoch);
    if (
      !config.types.Root.equals(
        target.root,
        chain.forkChoice.getAncestor(attestation.data.beaconBlockRoot.valueOf() as Uint8Array, targetSlot)!
      )
    ) {
      logger.verbose("Dropping attestation from processing", {
        reason: "attestation ancensor isnt target root",
        attestationHash: toHexString(attestationHash),
      });
      return;
    }

    const attestationPreState = await getAttestationPreState(config, chain, db, target);
    if (!attestationPreState) {
      //should not happen
      return;
    }
    await db.checkpointStateCache.add(target, attestationPreState);
    const indexedAttestation = attestationPreState.epochCtx.getIndexedAttestation(attestation);
    //TODO: we could signal to skip this in case it came from validated from gossip or from block
    //we need to check this again, because gossip validation might put it in pool before it validated signature
    if (!isValidIndexedAttestation(attestationPreState.epochCtx, attestationPreState.state, indexedAttestation, true)) {
      logger.verbose("Dropping attestation from processing", {
        reason: "invalid indexed attestation",
        attestationHash: toHexString(attestationHash),
      });
      return;
    }
    const validators = attestationPreState.epochCtx.getAttestingIndices(attestation.data, attestation.aggregationBits);
    const balances = validators.map((index) => attestationPreState.state.balances[index]);
    for (let i = 0; i < validators.length; i++) {
      chain.forkChoice.addAttestation(
        attestation.data.beaconBlockRoot.valueOf() as Uint8Array,
        validators[i],
        balances[i]
      );
    }
    logger.verbose(`Attestation ${toHexString(attestationHash)} passed to fork choice`);
    chain.emit("processedAttestation", attestation);
  } catch (e) {
    logger.warn("Failed to process attestation", {root: toHexString(attestationHash)});
  }
}
