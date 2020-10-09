import {Slot} from "@chainsafe/lodestar-types";
import {BeaconChain} from "..";

export async function handleClockSlot(this: BeaconChain, slot: Slot): Promise<void> {
  this.logger.verbose("Clock slot", {slot});
  this.forkChoice.updateTime(slot);
  await Promise.all(
    // Attestations can only affect the fork choice of subsequent slots.
    // Process the attestations in `slot - 1`, rather than `slot`
    this.pendingAttestations.getBySlot(slot - 1).map((job) => {
      this.pendingAttestations.remove(job);
      return this.attestationProcessor.processAttestationJob(job);
    })
  );
  await Promise.all(
    this.pendingBlocks.getBySlot(slot).map((job) => {
      this.pendingBlocks.remove(job);
      return this.blockProcessor.processBlockJob(job);
    })
  );
}
