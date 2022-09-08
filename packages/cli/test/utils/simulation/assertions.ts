import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {routes} from "@lodestar/api/beacon";
import {Slot} from "@lodestar/types";
import {SimulationEnvironment} from "./SimulationEnvironment.js";
import {avg} from "./utils.js";

chai.use(chaiAsPromised);

export function feeRecipientsAssertions(env: SimulationEnvironment): void {
  describe("fee recipient", () => {
    for (let n = 0; n < env.params.beaconNodes; n++) {
      describe(`beacon node "${n}"`, () => {
        it("should present fee recipients");
        it("should have valid fee recipient");
        it("should increment account balance for the fee recipient");
      });
    }
  });
}

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

export function nodeAssertions(env: SimulationEnvironment): void {
  it(`should have correct "${env.params.beaconNodes}" number of nodes`, () => {
    expect(env.nodes.length).to.equal(env.params.beaconNodes);
  });

  for (let n = 0; n < env.params.beaconNodes; n++) {
    describe(`beacon node "${n}"`, () => {
      it("should have correct health status", async () => {
        const node = env.nodes[n];
        const health = await node.api.node.getHealth();

        expect(health === routes.node.NodeHealth.SYNCING || health === routes.node.NodeHealth.READY).to.equal(
          true,
          `Node ${n} health is neither READY or SYNCING`
        );
      });

      it("should be completely synced", async () => {
        const node = env.nodes[n];
        const syncStatus = await node.api.node.getSyncingStatus();

        expect(syncStatus.data.isSyncing).to.equal(env.params.beaconNodes > 0 ? true : false);
      });

      it("should have correct number of validator clients", () => {
        const node = env.nodes[n];

        expect(node.validatorClients).to.have.lengthOf(env.params.validatorClients);
      });

      for (let v = 0; v < env.params.validatorClients; v++) {
        describe(`validator - ${v}`, () => {
          it("should have keymanager running", async () => {
            const validator = env.nodes[n].validatorClients[v];

            await expect(validator.keyManagerApi.listKeys()).to.be.fulfilled;
          });

          it("should have correct number of keys loaded", async () => {
            const validator = env.nodes[n].validatorClients[v];
            const keys = (await validator.keyManagerApi.listKeys()).data.map((k) => k.validatingPubkey).sort();
            const existingKeys = validator.secretKeys.map((k) => k.toPublicKey().toHex()).sort();

            expect(keys).to.eql(existingKeys);
          });
        });
      }
    });
  }
}

export function headAssertions(env: SimulationEnvironment): void {
  describe("head", () => {
    it("all nodes should have same head", async () => {
      const heads = await Promise.all(env.nodes.map((n) => n.api.beacon.getBlockHeader("head")));
      const headRoots = heads.map((h) => h.data.root);
      const firstHeadRoot = headRoots[0];

      for (let n = 1; n < env.params.beaconNodes; n++) {
        expect(headRoots[n]).to.equal(
          firstHeadRoot,
          [
            `node ${n} has different head than first node.`,
            `firstNode => Head: ${Buffer.from(firstHeadRoot).toString("hex")}, Slot: ${
              heads[0].data.header.message.slot
            }`,
            `Node${n} => Head: ${Buffer.from(headRoots[n]).toString("hex")}, Slot: ${
              heads[n].data.header.message.slot
            }`,
          ].join("")
        );
      }
    });

    it("all nodes should have same finality checkpoints on the head", async () => {
      const checkpoints = await Promise.all(env.nodes.map((n) => n.api.beacon.getStateFinalityCheckpoints("head")));
      const checkpointsOnFirstNode = checkpoints[0];

      for (let n = 1; n < env.params.beaconNodes; n++) {
        expect(checkpoints[n].data.currentJustified).to.deep.equal(
          checkpointsOnFirstNode.data.currentJustified,
          `node ${n} has different current justified than node 0`
        );

        expect(checkpoints[n].data.finalized).to.deep.equal(
          checkpointsOnFirstNode.data.finalized,
          `node ${n} has different finalized than node 0`
        );

        expect(checkpoints[n].data.previousJustified).to.deep.equal(
          checkpointsOnFirstNode.data.previousJustified,
          `node ${n} has different previous justified than node 0`
        );
      }
    });
  });
}

export function operationsAssertions(env: SimulationEnvironment): void {
  describe("operations", () => {
    for (let n = 0; n < env.params.beaconNodes; n++) {
      describe(`beacon node "${n}"`, () => {
        describe("deposits", () => {
          it("should process deposits in the block");
        });

        describe("graffiti", () => {
          it("should process graffiti in the block");
        });

        describe("validator activation", () => {
          it("should activates deposited validators");
        });

        describe("voluntary exist", () => {
          it("should exists the validators with voluntary exits");
        });
      });
    }
  });
}

export function peersAssertions(env: SimulationEnvironment): void {
  describe("peers", () => {
    for (let n = 0; n < env.params.beaconNodes; n++) {
      describe(`beacon node "${n}"`, () => {
        it("should have correct number of peers connected");
        describe("peer", () => {
          it("should have gossip score >=0");
          it("should have behavior penalty <= 0");
          it("should have block provider score >= 0");
          it("should have over all score >= 0");
          it("should not have any validation error");
        });
      });
    }
  });
}

export function slashingAssertions(env: SimulationEnvironment): void {
  describe("slashing", () => {
    for (let n = 0; n < env.params.beaconNodes; n++) {
      describe(`beacon node "${n}"`, () => {
        describe("broadcast double vote to detect slasher", () => {
          it("should slash expected number of validator");
          it("should make a validator loose balance");
        });

        describe("propose double block to detect slasher", () => {
          it("should slash expected number of validator");
          it("should make a validator loose balance");
        });
      });
    }
  });
}

export function participationAssertions(env: SimulationEnvironment, type: "HEAD" | "FFG"): void {
  const participation = type === "HEAD" ? env.tracker.participationOnHead : env.tracker.participationOnFFG;

  for (let n = 0; n < env.params.beaconNodes; n++) {
    const participationRate = participation.get(env.nodes[n].id) ?? new Map<number, number>();
    const participationRateAvg = avg([...participationRate.values()]);

    console.log(`==== ${env.nodes[n].id} - Participation on ${type} ====`);
    console.table(
      [...participationRate.entries()].map(([k, v]) => ({epoch: k, participation: v})),
      ["epoch", "participation"]
    );

    expect(participationRateAvg).to.be.gt(
      env.acceptableParticipationRate,
      `node ${n} has too low participation rate. participationRateAvg: ${participationRateAvg}, acceptableParticipationRate: ${env.acceptableParticipationRate}`
    );
  }
}

export function missedBlocksAssertions(env: SimulationEnvironment, slotLimit: Slot): void {
  const missedBlocks: {node: string; missedBlocks: Slot[]}[] = [];

  for (let i = 0; i < env.params.beaconNodes; i++) {
    const missedBlocksForNodeNode: Slot[] = [];

    for (let s = 0; s < slotLimit; s++) {
      if (!env.tracker.producedBlocks.get(env.nodes[i].id)?.get(s)) {
        missedBlocksForNodeNode.push(s);
      }
    }

    missedBlocks.push({node: env.nodes[i].id, missedBlocks: missedBlocksForNodeNode});
  }

  console.log("==== MISSED BLOCKS ====");
  console.table(missedBlocks, ["node", "missedBlocks"]);

  for (let i = 0; i < env.params.beaconNodes; i++) {
    expect(missedBlocks[i].missedBlocks).to.equal(
      missedBlocks[0].missedBlocks,
      `node ${i} has different missed blocks than node 0. node${i}MissedBlocks: ${missedBlocks[i].missedBlocks}, node0MissedBlocks: ${missedBlocks[0].missedBlocks}`
    );
  }
}
