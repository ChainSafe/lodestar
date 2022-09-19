import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {routes} from "@lodestar/api/beacon";
import {Epoch} from "@lodestar/types";
import {SimulationEnvironment} from "./SimulationEnvironment.js";

chai.use(chaiAsPromised);

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

      it("should have correct number validator clients", async () => {
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
        const participation = env.tracker.attestationParticipation.get(node.id)?.get(epoch);

        expect(participation?.head).to.be.gte(
          env.acceptableParticipationRate,
          `node "${node.id}" has low participation rate on head for epoch ${epoch}. participationRate: ${participation?.head}, acceptableParticipationRate: ${env.acceptableParticipationRate}`
        );
      });

      it("should have correct attestation on target", () => {
        const participation = env.tracker.attestationParticipation.get(node.id)?.get(epoch);

        expect(participation?.target).to.be.gte(
          env.acceptableParticipationRate,
          `node "${node.id}" has low participation rate on target for epoch ${epoch}. participationRate: ${participation?.head}, acceptableParticipationRate: ${env.acceptableParticipationRate}`
        );
      });

      it("should have correct attestation on source", () => {
        const participation = env.tracker.attestationParticipation.get(node.id)?.get(epoch);

        expect(participation?.source).to.be.gte(
          env.acceptableParticipationRate,
          `node "${node.id}" has low participation rate on source for epoch ${epoch}. participationRate: ${participation?.head}, acceptableParticipationRate: ${env.acceptableParticipationRate}`
        );
      });
    });
  }
}

export function missedBlocksAssertions(env: SimulationEnvironment): void {
  if (env.params.beaconNodes === 1) {
    it("should not have any missed blocks than genesis", () => {
      expect(env.tracker.missedBlocks.get(env.nodes[0].id)).to.be.eql(
        [0],
        "single node should not miss any blocks other than genesis"
      );
    });
    return;
  }

  for (const node of env.nodes) {
    describe(node.id, () => {
      it("should have same missed blocks as first node", () => {
        const missedBlocksOnFirstNode = env.tracker.missedBlocks.get(env.nodes[0].id);
        const missedBlocksOnNodeN = env.tracker.missedBlocks.get(node.id);

        expect(missedBlocksOnNodeN).to.eql(
          missedBlocksOnFirstNode,
          `node "${node.id}" has different missed blocks than node 0. missedBlocksOnNodeN: ${missedBlocksOnNodeN}, missedBlocksOnFirstNode: ${missedBlocksOnFirstNode}`
        );
      });
    });
  }
}
