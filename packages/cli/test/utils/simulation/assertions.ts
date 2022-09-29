import {expect} from "chai";
import {routes} from "@lodestar/api/beacon";
import {Epoch} from "@lodestar/types";
import {MAX_COMMITTEES_PER_SLOT} from "@lodestar/params";
import {SimulationEnvironment} from "./SimulationEnvironment.js";

export function nodeAssertions(env: SimulationEnvironment): void {
  it("test env should have correct number of nodes", () => {
    expect(env.nodes.length).to.equal(
      env.params.beaconNodes,
      `should have "${env.params.beaconNodes}" number of nodes. Found: ${env.nodes.length}`
    );
  });

  for (const node of env.nodes) {
    describe(node.id, () => {
      it("should have correct sync status", async () => {
        const health = await node.api.node.getHealth();

        expect(health === routes.node.NodeHealth.SYNCING || health === routes.node.NodeHealth.READY).to.equal(
          true,
          `Node "${node.id}" health is neither READY or SYNCING`
        );
      });

      it("should have correct number of validator clients", async () => {
        expect(node.validatorClients).to.have.lengthOf(
          env.params.validatorClients,
          `Node "${node.id}" have correct "${env.params.validatorClients}" of validator clients. Found: ${node.validatorClients.length}`
        );
      });

      for (const validator of node.validatorClients) {
        describe(validator.id, () => {
          it("should have correct keys loaded", async () => {
            const keys = (await validator.keyManagerApi.listKeys()).data.map((k) => k.validatingPubkey).sort();
            const existingKeys = validator.secretKeys.map((k) => k.toPublicKey().toHex()).sort();

            expect(keys).to.eql(
              existingKeys,
              `Validator "${validator.id}" should have correct number of keys loaded. Generated Keys: ${existingKeys}, Loaded Keys: ${keys}`
            );
          });
        });
      }
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
          env.acceptableParticipationRate,
          `node "${node.id}" has low participation rate on head for epoch ${epoch}. participationRate: ${participation?.head}, acceptableParticipationRate: ${env.acceptableParticipationRate}`
        );
      });

      it("should have correct attestation on target", () => {
        const participation = env.tracker.epochMeasures.get(node.id)?.get(epoch)?.attestationParticipationAvg;

        expect(participation?.target).to.be.gte(
          env.acceptableParticipationRate,
          `node "${node.id}" has low participation rate on target for epoch ${epoch}. participationRate: ${participation?.target}, acceptableParticipationRate: ${env.acceptableParticipationRate}`
        );
      });

      it("should have correct attestation on source", () => {
        const participation = env.tracker.epochMeasures.get(node.id)?.get(epoch)?.attestationParticipationAvg;

        expect(participation?.source).to.be.gte(
          env.acceptableParticipationRate,
          `node "${node.id}" has low participation rate on source for epoch ${epoch}. participationRate: ${participation?.source}, acceptableParticipationRate: ${env.acceptableParticipationRate}`
        );
      });
    });
  }
}

export function missedBlocksAssertions(env: SimulationEnvironment, epoch: Epoch): void {
  if (env.params.beaconNodes === 1) {
    it("should not have any missed blocks than genesis", () => {
      expect(env.tracker.epochMeasures.get(env.nodes[0].id)?.get(epoch)?.missedSlots).to.be.eql(
        [],
        "single node should not miss any blocks other than genesis"
      );
    });
    return;
  }

  for (const node of env.nodes) {
    describe(node.id, () => {
      it("should have same missed blocks as first node", () => {
        const missedBlocksOnFirstNode = env.tracker.epochMeasures.get(env.nodes[0].id)?.get(epoch)?.missedSlots;
        const missedBlocksOnNodeN = env.tracker.epochMeasures.get(node.id)?.get(epoch)?.missedSlots;

        expect(missedBlocksOnNodeN).to.eql(
          missedBlocksOnFirstNode,
          `node "${node.id}" has different missed blocks than node 0. missedBlocksOnNodeN: ${missedBlocksOnNodeN}, missedBlocksOnFirstNode: ${missedBlocksOnFirstNode}`
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
        it(`should not have higher inclusion delay for attestations in slot "${slot}"`, () => {
          const inclusionDelay = env.tracker.slotMeasures.get(node.id)?.get(slot)?.inclusionDelay;
          const acceptableMaxInclusionDelay = env.acceptableMaxInclusionDelay;

          expect(inclusionDelay).to.lte(
            acceptableMaxInclusionDelay,
            `node "${node.id}" has has higher inclusion delay. slot: ${slot}, inclusionDelay: ${inclusionDelay}, acceptableMaxInclusionDelay: ${acceptableMaxInclusionDelay}`
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
        it(`should have attestations count equals to MAX_COMMITTEES_PER_SLOT for slot "${slot}"`, () => {
          const attestationsCount = env.tracker.slotMeasures.get(node.id)?.get(slot)?.attestationsCount;

          expect(attestationsCount).to.eql(
            MAX_COMMITTEES_PER_SLOT,
            `node "${node.id}" has lower number of attestations for slot "${slot}".`
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
            `node "${node.id}" has not finalized expected slot. slot: ${slot}, finalizedSlot: ${finalizedSlot}, expectedFinalizedSlot: ${expectedFinalizedSlot}`
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
          const headOnNNode = env.tracker.slotMeasures.get(node.id)?.get(slot)?.head;

          expect(headOnNNode).to.eql(
            headOnFirstNode,
            `node "${node.id}" have different heads for slot: ${slot}, headOnFirstNode: ${headOnFirstNode}, headOnNNode: ${headOnNNode}`
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
          const acceptableMinSyncParticipation = env.acceptableMinSyncParticipation;

          expect(participation).to.gte(
            acceptableMinSyncParticipation,
            `node "${node.id}" low sync committee participation slot: ${slot}, participation: ${participation}, acceptableMinSyncParticipation: ${acceptableMinSyncParticipation}`
          );
        });
      }
    });
  }
}
