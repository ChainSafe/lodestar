import {expect} from "chai";
import {routes} from "@lodestar/api/beacon";
import {Epoch, Slot} from "@lodestar/types";
import {MAX_COMMITTEES_PER_SLOT} from "@lodestar/params";
import {SimulationEnvironment} from "./SimulationEnvironment.js";
import {NodePair} from "./interfaces.js";

export function nodeAssertions(env: SimulationEnvironment): void {
  for (const node of env.nodes) {
    describe(node.cl.id, () => {
      it("should have correct sync status for cl", async () => {
        const health = await node.cl.api.node.getHealth();

        expect(health === routes.node.NodeHealth.SYNCING || health === routes.node.NodeHealth.READY).to.equal(
          true,
          `node health is neither READY or SYNCING. ${JSON.stringify({id: node.cl.id})}`
        );
      });

      it("should have correct keys loaded", async () => {
        const keyManagerKeys = (await node.cl.keyManager.listKeys()).data.map((k) => k.validatingPubkey).sort();
        const existingKeys = [
          ...node.cl.remoteKeys.map((k) => k.toPublicKey().toHex()),
          ...node.cl.localKeys.map((k) => k.toPublicKey().toHex()),
        ].sort();

        expect(keyManagerKeys).to.eql(
          existingKeys,
          `Validator should have correct number of keys loaded. ${JSON.stringify({
            id: node.cl.id,
            existingKeys,
            keyManagerKeys,
          })}`
        );
      });
    });
  }
}

export function attestationParticipationAssertions(env: SimulationEnvironment, epoch: Epoch): void {
  if (epoch < env.forkConfig.ALTAIR_FORK_EPOCH) return;

  for (const node of env.nodes) {
    describe(`${node.cl.id}`, () => {
      it("should have correct attestation on head", () => {
        const participation = env.tracker.epochMeasures.get(node.cl.id)?.get(epoch)?.attestationParticipationAvg;

        expect(participation?.head).to.be.gte(
          env.expectedMinParticipationRate,
          `node has low participation rate on head. ${JSON.stringify({
            id: node.cl.id,
            epoch,
            participation: participation?.head,
            expectedMinParticipationRate: env.expectedMinParticipationRate,
          })}`
        );
      });

      it("should have correct attestation on target", () => {
        const participation = env.tracker.epochMeasures.get(node.cl.id)?.get(epoch)?.attestationParticipationAvg;

        expect(participation?.target).to.be.gte(
          env.expectedMinParticipationRate,
          `node has low participation rate on target. ${JSON.stringify({
            id: node.cl.id,
            epoch,
            participation: participation?.head,
            expectedMinParticipationRate: env.expectedMinParticipationRate,
          })}`
        );
      });

      it("should have correct attestation on source", () => {
        const participation = env.tracker.epochMeasures.get(node.cl.id)?.get(epoch)?.attestationParticipationAvg;

        expect(participation?.source).to.be.gte(
          env.expectedMinParticipationRate,
          `node has low participation rate on source. ${JSON.stringify({
            id: node.cl.id,
            epoch,
            participation: participation?.head,
            expectedMinParticipationRate: env.expectedMinParticipationRate,
          })}`
        );
      });
    });
  }
}

export function missedBlocksAssertions(env: SimulationEnvironment, epoch: Epoch): void {
  for (const node of env.nodes) {
    describe(node.cl.id, () => {
      it("should have same missed blocks as first node", () => {
        const missedBlocksOnFirstNode = env.tracker.epochMeasures.get(env.nodes[0].cl.id)?.get(epoch)?.missedSlots;
        const missedBlocksOnNode = env.tracker.epochMeasures.get(node.cl.id)?.get(epoch)?.missedSlots;

        expect(missedBlocksOnNode).to.eql(
          missedBlocksOnFirstNode,
          `node has different missed blocks than node 0. ${JSON.stringify({
            id: node.cl.id,
            missedBlocksOnNode,
            missedBlocksOnFirstNode,
          })}`
        );
      });
    });
  }
}

export function inclusionDelayAssertions(env: SimulationEnvironment, epoch: Epoch): void {
  for (const node of env.nodes) {
    describe(node.cl.id, () => {
      const startSlot = epoch === 0 ? 1 : env.clock.getFirstSlotOfEpoch(epoch);
      const endSlot = env.clock.getLastSlotOfEpoch(epoch);

      for (let slot = startSlot; slot <= endSlot; slot++) {
        it(`should have lower attestations inclusion delay for slot "${slot}"`, () => {
          const inclusionDelay = env.tracker.slotMeasures.get(node.cl.id)?.get(slot)?.inclusionDelay;

          expect(inclusionDelay).to.lte(
            env.expectedMaxInclusionDelay,
            `node  has has higher inclusion delay. ${JSON.stringify({
              id: node.cl.id,
              slot,
              epoch,
              inclusionDelay,
              expectedMaxInclusionDelay: env.expectedMaxInclusionDelay,
            })}`
          );
        });
      }
    });
  }
}

export function attestationPerSlotAssertions(env: SimulationEnvironment, epoch: Epoch): void {
  for (const node of env.nodes) {
    describe(node.cl.id, () => {
      const startSlot = epoch === 0 ? 1 : env.clock.getFirstSlotOfEpoch(epoch);
      const endSlot = env.clock.getLastSlotOfEpoch(epoch);

      for (let slot = startSlot; slot <= endSlot; slot++) {
        it(`should have higher attestation count for slot "${slot}"`, () => {
          const attestationsCount = env.tracker.slotMeasures.get(node.cl.id)?.get(slot)?.attestationsCount ?? 0;
          // Inclusion delay for future slot
          const nextSlotInclusionDelay = env.tracker.slotMeasures.get(node.cl.id)?.get(slot + 1)?.inclusionDelay ?? 0;

          // If some attestations are not included, probably will be included in next slot.
          // In that case next slot inclusion delay will be higher than expected.
          if (attestationsCount < MAX_COMMITTEES_PER_SLOT && nextSlotInclusionDelay <= env.expectedMaxInclusionDelay) {
            expect(attestationsCount).to.gte(
              env.expectedMinAttestationCount,
              `node has lower attestations count. ${JSON.stringify({
                id: node.cl.id,
                slot,
                epoch,
                attestationsCount,
                expectedMinAttestationCount: env.expectedMinAttestationCount,
              })}`
            );
          }
        });
      }
    });
  }
}

export function finalityAssertions(env: SimulationEnvironment, epoch: Epoch): void {
  for (const node of env.nodes) {
    describe(node.cl.id, () => {
      const startSlot = env.clock.getFirstSlotOfEpoch(epoch);
      const endSlot = env.clock.getLastSlotOfEpoch(epoch);

      for (let slot = startSlot; slot <= endSlot; slot++) {
        it(`should have correct finalized slot for slot "${slot}"`, () => {
          // The slots start finalizing from 4th epoch
          const expectedFinalizedSlot =
            slot < env.clock.getLastSlotOfEpoch(4)
              ? 0
              : env.clock.getFirstSlotOfEpoch(env.clock.getEpochForSlot(slot) - 2);

          const finalizedSlot = env.tracker.slotMeasures.get(node.cl.id)?.get(slot)?.finalizedSlot;

          expect(finalizedSlot).to.gte(
            expectedFinalizedSlot,
            `node has not finalized expected slot. ${JSON.stringify({
              id: node.cl.id,
              slot,
              epoch,
              finalizedSlot,
              expectedFinalizedSlot,
            })}`
          );
        });
      }
    });
  }
}

export function headsAssertions(env: SimulationEnvironment, epoch: Epoch): void {
  for (let i = 1; i < env.nodes.length; i++) {
    const node = env.nodes[i];
    describe(node.cl.id, () => {
      const startSlot = env.clock.getFirstSlotOfEpoch(epoch);
      const endSlot = env.clock.getLastSlotOfEpoch(epoch);

      for (let slot = startSlot; slot <= endSlot; slot++) {
        it(`should have same head as first node for slot "${slot}"`, () => {
          const headOnFirstNode = env.tracker.slotMeasures.get(env.nodes[0].cl.id)?.get(slot)?.head;
          const headOnNode = env.tracker.slotMeasures.get(node.cl.id)?.get(slot)?.head;

          expect(headOnNode).to.eql(
            headOnFirstNode,
            `node have different heads. ${JSON.stringify({slot, epoch, headOnFirstNode, headOnNode})}`
          );
        });
      }
    });
  }
}

export function syncCommitteeAssertions(env: SimulationEnvironment, epoch: Epoch): void {
  if (epoch < env.forkConfig.ALTAIR_FORK_EPOCH) {
    return;
  }

  for (const node of env.nodes) {
    describe(node.cl.id, () => {
      const startSlot = env.clock.getFirstSlotOfEpoch(epoch);
      const endSlot = env.clock.getLastSlotOfEpoch(epoch);
      const altairStartSlot = env.clock.getFirstSlotOfEpoch(env.forkConfig.ALTAIR_FORK_EPOCH);

      for (let slot = startSlot; slot <= endSlot; slot++) {
        // Sync committee is not available before until 2 slots for altair epoch
        if (slot === altairStartSlot || slot === altairStartSlot + 1) {
          continue;
        }

        it(`should have have higher participation for slot "${slot}"`, () => {
          const participation = env.tracker.slotMeasures.get(env.nodes[0].cl.id)?.get(slot)?.syncCommitteeParticipation;

          expect(participation).to.gte(
            env.expectedMinSyncParticipationRate,
            `node has low sync committee participation. ${JSON.stringify({
              id: node.cl.id,
              slot,
              epoch,
              participation,
              expectedMinSyncParticipationRate: env.expectedMinSyncParticipationRate,
            })}`
          );
        });
      }
    });
  }
}

export function nodeSyncedAssertions(env: SimulationEnvironment, node: NodePair, maxSlot: Slot): Promise<void> {
  return new Promise((resolve, reject) => {
    const intervalId = setInterval(async () => {
      const res = await node.cl.api.node.getSyncingStatus();

      if (!res.data.isSyncing) {
        clearInterval(intervalId);
        resolve();
      } else if (env.clock.currentSlot > maxSlot) {
        clearInterval(intervalId);
        reject(new Error(`Node ${node.cl.id} is still syncing`));
      }
    }, 500);
  });
}
