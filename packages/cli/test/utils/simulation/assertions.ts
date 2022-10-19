import {expect} from "chai";
import {routes} from "@lodestar/api/beacon";
import {Epoch} from "@lodestar/types";
import {SimulationEnvironment} from "./SimulationEnvironment.js";

export function nodeAssertions(env: SimulationEnvironment): void {
  it("test env should have correct number of nodes", () => {
    expect(env.nodes.length).to.equal(env.params.beaconNodes);
  });

  for (const node of env.nodes) {
    describe(node.id, () => {
      it("should have correct sync status", async () => {
        const health = await node.api.node.getHealth();

        expect(health === routes.node.NodeHealth.SYNCING || health === routes.node.NodeHealth.READY).to.equal(
          true,
          `node health is neither READY or SYNCING. ${JSON.stringify({id: node.id})}`
        );
      });

      it("should have correct keys loaded", async () => {
        const keyManagerKeys = (await node.keyManager.listKeys()).data.map((k) => k.validatingPubkey).sort();
        const existingKeys = node.secretKeys.map((k) => k.toPublicKey().toHex()).sort();

        expect(keyManagerKeys).to.eql(
          existingKeys,
          `Validator should have correct number of keys loaded. ${JSON.stringify({
            id: node.id,
            existingKeys,
            keyManagerKeys,
          })}`
        );
      });
    });
  }
}

export function attestationParticipationAssertions(env: SimulationEnvironment, epoch: Epoch): void {
  if (epoch < env.params.altairEpoch) return;

  for (const node of env.nodes) {
    describe(`${node.id}`, () => {
      it("should have correct attestation on head", () => {
        const participation = env.tracker.epochMeasures.get(node.id)?.get(epoch)?.attestationParticipationAvg;

        expect(participation?.head).to.be.gte(
          env.expectedMinParticipationRate,
          `node has low participation rate on head. ${JSON.stringify({
            id: node.id,
            epoch,
            participation: participation?.head,
            expectedMinParticipationRate: env.expectedMinParticipationRate,
          })}`
        );
      });

      it("should have correct attestation on target", () => {
        const participation = env.tracker.epochMeasures.get(node.id)?.get(epoch)?.attestationParticipationAvg;

        expect(participation?.target).to.be.gte(
          env.expectedMinParticipationRate,
          `node has low participation rate on target. ${JSON.stringify({
            id: node.id,
            epoch,
            participation: participation?.head,
            expectedMinParticipationRate: env.expectedMinParticipationRate,
          })}`
        );
      });

      it("should have correct attestation on source", () => {
        const participation = env.tracker.epochMeasures.get(node.id)?.get(epoch)?.attestationParticipationAvg;

        expect(participation?.source).to.be.gte(
          env.expectedMinParticipationRate,
          `node has low participation rate on source. ${JSON.stringify({
            id: node.id,
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
  if (env.params.beaconNodes === 1) {
    it("should not have any missed blocks than genesis", () => {
      const missedSlots = env.tracker.epochMeasures.get(env.nodes[0].id)?.get(epoch)?.missedSlots;
      expect(missedSlots).to.be.eql(
        [],
        `node has missed blocks than genesis. ${JSON.stringify({id: env.nodes[0].id, missedSlots})}`
      );
    });
    return;
  }

  for (const node of env.nodes) {
    describe(node.id, () => {
      it("should have same missed blocks as first node", () => {
        const missedBlocksOnFirstNode = env.tracker.epochMeasures.get(env.nodes[0].id)?.get(epoch)?.missedSlots;
        const missedBlocksOnNode = env.tracker.epochMeasures.get(node.id)?.get(epoch)?.missedSlots;

        expect(missedBlocksOnNode).to.eql(
          missedBlocksOnFirstNode,
          `node has different missed blocks than node 0. ${JSON.stringify({
            id: node.id,
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
    describe(node.id, () => {
      const startSlot = epoch === 0 ? 1 : env.clock.getFirstSlotOfEpoch(epoch);
      const endSlot = env.clock.getLastSlotOfEpoch(epoch);

      for (let slot = startSlot; slot <= endSlot; slot++) {
        it(`should have lower attestations inclusion delay for slot "${slot}"`, () => {
          const inclusionDelay = env.tracker.slotMeasures.get(node.id)?.get(slot)?.inclusionDelay;

          expect(inclusionDelay).to.lte(
            env.expectedMaxInclusionDelay,
            `node  has has higher inclusion delay. ${JSON.stringify({
              id: node.id,
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
    describe(node.id, () => {
      const startSlot = epoch === 0 ? 1 : env.clock.getFirstSlotOfEpoch(epoch);
      const endSlot = env.clock.getLastSlotOfEpoch(epoch);

      for (let slot = startSlot; slot <= endSlot; slot++) {
        it(`should have higher attestation count for slot "${slot}"`, () => {
          const attestationsCount = env.tracker.slotMeasures.get(node.id)?.get(slot)?.attestationsCount;

          expect(attestationsCount).to.gte(
            env.expectedMinAttestationCount,
            `node has lower attestations count. ${JSON.stringify({
              id: node.id,
              slot,
              epoch,
              attestationsCount,
              expectedMinAttestationCount: env.expectedMinAttestationCount,
            })}`
          );
        });
      }
    });
  }
}

export function finalityAssertions(env: SimulationEnvironment, epoch: Epoch): void {
  for (const node of env.nodes) {
    describe(node.id, () => {
      const startSlot = env.clock.getFirstSlotOfEpoch(epoch);
      const endSlot = env.clock.getLastSlotOfEpoch(epoch);

      for (let slot = startSlot; slot <= endSlot; slot++) {
        it(`should have correct finalized slot for slot "${slot}"`, () => {
          // The slots start finalizing from 4th epoch
          const expectedFinalizedSlot =
            slot < env.clock.getLastSlotOfEpoch(4)
              ? 0
              : env.clock.getFirstSlotOfEpoch(env.clock.getEpochForSlot(slot) - 2);

          const finalizedSlot = env.tracker.slotMeasures.get(node.id)?.get(slot)?.finalizedSlot;

          expect(finalizedSlot).to.gte(
            expectedFinalizedSlot,
            `node has not finalized expected slot. ${JSON.stringify({
              id: node.id,
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
    describe(node.id, () => {
      const startSlot = env.clock.getFirstSlotOfEpoch(epoch);
      const endSlot = env.clock.getLastSlotOfEpoch(epoch);

      for (let slot = startSlot; slot <= endSlot; slot++) {
        it(`should have same head as first node for slot "${slot}"`, () => {
          const headOnFirstNode = env.tracker.slotMeasures.get(env.nodes[0].id)?.get(slot)?.head;
          const headOnNode = env.tracker.slotMeasures.get(node.id)?.get(slot)?.head;

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
  if (epoch < env.params.altairEpoch) {
    return;
  }

  for (const node of env.nodes) {
    describe(node.id, () => {
      const startSlot = env.clock.getFirstSlotOfEpoch(epoch);
      const endSlot = env.clock.getLastSlotOfEpoch(epoch);
      const altairStartSlot = env.clock.getFirstSlotOfEpoch(env.params.altairEpoch);

      for (let slot = startSlot; slot <= endSlot; slot++) {
        // Sync committee is not available before until 2 slots for altair epoch
        if (slot === altairStartSlot || slot === altairStartSlot + 1) {
          continue;
        }

        it(`should have have higher participation for slot "${slot}"`, () => {
          const participation = env.tracker.slotMeasures.get(env.nodes[0].id)?.get(slot)?.syncCommitteeParticipation;

          expect(participation).to.gte(
            env.expectedMinSyncParticipationRate,
            `node has low sync committee participation. ${JSON.stringify({
              id: node.id,
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
