import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {routes} from "@lodestar/api/beacon";
import {SimulationEnvironment} from "./SimulationEnvironment.js";

chai.use(chaiAsPromised);

export function finalityAssertions(env: SimulationEnvironment): void {
  describe("finality", () => {
    for (let n = 0; n < env.params.beaconNodes; n++) {
      describe(`beacon node "${n}"`, () => {
        it("should have proper finality", async function () {
          const node = env.nodes[n];
          const checkpoints = await node.api.beacon.getStateFinalityCheckpoints("head");
          const currentSlot = env.clock.currentSlot;
          const previousJustifiedSlot = checkpoints.data.previousJustified.epoch;
          const currentJustifiedSlot = checkpoints.data.currentJustified.epoch;
          const finalizedSlot = checkpoints.data.finalized.epoch;

          expect(finalizedSlot).to.equal(currentSlot - 2);
          expect(previousJustifiedSlot + 1).to.equal(
            currentJustifiedSlot,
            `there should be no gaps between current and previous justified epochs, received current ${currentJustifiedSlot} and previous ${previousJustifiedSlot}`
          );
          expect(currentJustifiedSlot + 1).to.equal(
            finalizedSlot,
            `there should be no gaps between finalized and previous justified epochs, received finalized ${finalizedSlot} and previous ${previousJustifiedSlot}`
          );
        });
      });
    }
  });
}

export async function nodeAssertions(env: SimulationEnvironment): Promise<void> {
  expect(env.nodes.length).to.equal(
    env.params.beaconNodes,
    `should have "${env.params.beaconNodes}" number of nodes. Found: ${env.nodes.length}`
  );

  for (let n = 0; n < env.params.beaconNodes; n++) {
    const node = env.nodes[n];
    const health = await node.api.node.getHealth();

    expect(health === routes.node.NodeHealth.SYNCING || health === routes.node.NodeHealth.READY).to.equal(
      true,
      `Node "${node.id}" health is neither READY or SYNCING`
    );

    expect(node.validatorClients).to.have.lengthOf(
      env.params.validatorClients,
      `Node "${node.id}" have correct "${env.params.validatorClients}" of validator clients. Found: ${node.validatorClients.length}`
    );

    for (let v = 0; v < env.params.validatorClients; v++) {
      const validator = env.nodes[n].validatorClients[v];

      const keys = (await validator.keyManagerApi.listKeys()).data.map((k) => k.validatingPubkey).sort();
      const existingKeys = validator.secretKeys.map((k) => k.toPublicKey().toHex()).sort();

      expect(keys).to.eql(
        existingKeys,
        `Validator "${validator.id}" should have correct number of keys loaded. Generated Keys: ${existingKeys}, Loaded Keys: ${keys}`
      );
    }
  }
}

export function attestationParticipationAssertions(env: SimulationEnvironment): void {
  const participation = env.tracker.attestationParticipation;

  for (let n = 0; n < env.params.beaconNodes; n++) {
    const participationRate = participation.get(env.nodes[n].id);
    if (!participationRate) continue;

    for (const [epoch, participation] of participationRate.entries()) {
      if (epoch < env.params.altairEpoch) continue;

      expect(participation.head).to.be.gt(
        env.acceptableParticipationRate,
        `node "${env.nodes[n].id}" has too low participation rate on head for epoch ${epoch}. participationRate: ${participation.head}, acceptableParticipationRate: ${env.acceptableParticipationRate}`
      );

      expect(participation.source).to.be.gt(
        env.acceptableParticipationRate,
        `node "${env.nodes[n].id}" has too low participation rate on source for epoch ${epoch}. participationRate: ${participation.source}, acceptableParticipationRate: ${env.acceptableParticipationRate}`
      );

      expect(participation.target).to.be.gt(
        env.acceptableParticipationRate,
        `node "${env.nodes[n].id}" has too low participation rate on target for epoch ${epoch}. participationRate: ${participation.target}, acceptableParticipationRate: ${env.acceptableParticipationRate}`
      );
    }
  }
}

export function missedBlocksAssertions(env: SimulationEnvironment): void {
  if (env.params.beaconNodes === 1) {
    expect(env.tracker.missedBlocks.get(env.nodes[0].id)).to.be.eql(
      [0],
      "single node should not miss any blocks other than genesis"
    );
    return;
  }

  const missedBlocks = env.tracker.missedBlocks;
  const missedBlocksOnFirstNode = missedBlocks.get(env.nodes[0].id);

  for (let i = 0; i < env.params.beaconNodes; i++) {
    expect(missedBlocks.get(env.nodes[i].id)).to.eql(
      missedBlocksOnFirstNode,
      `node "${env.nodes[i].id}" has different missed blocks than node 0. node${i}MissedBlocks: ${missedBlocks.get(
        env.nodes[i].id
      )}, node0MissedBlocks: ${missedBlocksOnFirstNode}`
    );
  }
}

// export function operationsAssertions(env: SimulationEnvironment): void {
//   describe("operations", () => {
//     for (let n = 0; n < env.params.beaconNodes; n++) {
//       describe(`beacon node "${n}"`, () => {
//         describe("deposits", () => {
//           it("should process deposits in the block");
//         });

//         describe("graffiti", () => {
//           it("should process graffiti in the block");
//         });

//         describe("validator activation", () => {
//           it("should activates deposited validators");
//         });

//         describe("voluntary exist", () => {
//           it("should exists the validators with voluntary exits");
//         });
//       });
//     }
//   });
// }

// export function peersAssertions(env: SimulationEnvironment): void {
//   describe("peers", () => {
//     for (let n = 0; n < env.params.beaconNodes; n++) {
//       describe(`beacon node "${n}"`, () => {
//         it("should have correct number of peers connected");
//         describe("peer", () => {
//           it("should have gossip score >=0");
//           it("should have behavior penalty <= 0");
//           it("should have block provider score >= 0");
//           it("should have over all score >= 0");
//           it("should not have any validation error");
//         });
//       });
//     }
//   });
// }

// export function slashingAssertions(env: SimulationEnvironment): void {
//   describe("slashing", () => {
//     for (let n = 0; n < env.params.beaconNodes; n++) {
//       describe(`beacon node "${n}"`, () => {
//         describe("broadcast double vote to detect slasher", () => {
//           it("should slash expected number of validator");
//           it("should make a validator loose balance");
//         });

//         describe("propose double block to detect slasher", () => {
//           it("should slash expected number of validator");
//           it("should make a validator loose balance");
//         });
//       });
//     }
//   });
// }
//
// export function feeRecipientsAssertions(env: SimulationEnvironment): void {
//   describe("fee recipient", () => {
//     for (let n = 0; n < env.params.beaconNodes; n++) {
//       describe(`beacon node "${n}"`, () => {
//         it("should present fee recipients");
//         it("should have valid fee recipient");
//         it("should increment account balance for the fee recipient");
//       });
//     }
//   });
// }
// export function headAssertions(env: SimulationEnvironment): void {
//   describe("head", () => {
//     it("all nodes should have same head", async () => {
//       const heads = await Promise.all(env.nodes.map((n) => n.api.beacon.getBlockHeader("head")));
//       const headRoots = heads.map((h) => h.data.root);
//       const firstHeadRoot = headRoots[0];

//       for (let n = 1; n < env.params.beaconNodes; n++) {
//         expect(headRoots[n]).to.equal(
//           firstHeadRoot,
//           [
//             `node ${n} has different head than first node.`,
//             `firstNode => Head: ${Buffer.from(firstHeadRoot).toString("hex")}, Slot: ${
//               heads[0].data.header.message.slot
//             }`,
//             `Node${n} => Head: ${Buffer.from(headRoots[n]).toString("hex")}, Slot: ${
//               heads[n].data.header.message.slot
//             }`,
//           ].join("")
//         );
//       }
//     });

//     it("all nodes should have same finality checkpoints on the head", async () => {
//       const checkpoints = await Promise.all(env.nodes.map((n) => n.api.beacon.getStateFinalityCheckpoints("head")));
//       const checkpointsOnFirstNode = checkpoints[0];

//       for (let n = 1; n < env.params.beaconNodes; n++) {
//         expect(checkpoints[n].data.currentJustified).to.deep.equal(
//           checkpointsOnFirstNode.data.currentJustified,
//           `node ${n} has different current justified than node 0`
//         );

//         expect(checkpoints[n].data.finalized).to.deep.equal(
//           checkpointsOnFirstNode.data.finalized,
//           `node ${n} has different finalized than node 0`
//         );

//         expect(checkpoints[n].data.previousJustified).to.deep.equal(
//           checkpointsOnFirstNode.data.previousJustified,
//           `node ${n} has different previous justified than node 0`
//         );
//       }
//     });
//   });
// }
