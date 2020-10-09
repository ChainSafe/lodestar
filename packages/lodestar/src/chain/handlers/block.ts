import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {readOnlyMap, toHexString} from "@chainsafe/ssz";
import {IBlockJob} from "..";
import {ITreeStateContext} from "../../db/api/beacon/stateContextCache";
import {BeaconChain} from "../chain";
export async function handleBlock(
  this: BeaconChain,
  block: SignedBeaconBlock,
  postStateContext: ITreeStateContext,
  job: IBlockJob
): Promise<void> {
  const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(block.message);
  this.logger.debug("Block processed", {
    slot: block.message.slot,
    root: toHexString(blockRoot),
  });
  this.metrics.currentSlot.set(block.message.slot);
  await this.db.stateCache.add(postStateContext);
  if (!job.reprocess) {
    await this.db.block.add(block);
  }
  if (!job.trusted) {
    // Only process attestations in response to an "untrusted" block
    await Promise.all([
      // process the attestations in the block
      ...readOnlyMap(block.message.body.attestations, (attestation) => {
        return this.attestationProcessor.processAttestationJob({
          attestation,
          // attestation signatures from blocks have already been verified
          validSignature: true,
        });
      }),
      // process pending attestations which needed the block
      ...this.pendingAttestations.getByBlock(blockRoot).map((job) => {
        this.pendingAttestations.remove(job);
        return this.attestationProcessor.processAttestationJob(job);
      }),
    ]);
  }
  await this.db.processBlockOperations(block);
  await Promise.all(
    this.pendingBlocks.getByParent(blockRoot).map((job) => {
      this.pendingBlocks.remove(job);
      return this.blockProcessor.processBlockJob(job);
    })
  );
}
