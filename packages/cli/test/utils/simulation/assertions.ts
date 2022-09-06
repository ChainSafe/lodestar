import {expect} from "chai";
import {altair} from "@lodestar/types";
import {HttpError} from "@lodestar/api";
import {SimulationEnvironment} from "./SimulationEnvironment.js";
import {computeAttestationParticipation} from "./utils.js";

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
  describe("node", () => {
    it(`should have correct "${env.params.beaconNodes}" number of nodes`, () => {
      expect(env.nodes.length).to.equal(env.params.beaconNodes);
    });

    for (let n = 0; n < env.params.beaconNodes; n++) {
      describe(`beacon node "${n}"`, () => {
        it("should have correct health status", async () => {
          const node = env.nodes[n];
          expect(await node.api.node.getHealth()).to.equal(200);
        });

        it("should be completely synced", async () => {
          const node = env.nodes[n];
          const syncStatus = await node.api.node.getSyncingStatus();

          expect(syncStatus.data.isSyncing).to.equal(false);
          expect(syncStatus.data.syncDistance).to.equal("0");
        });

        // NOT POSSIBLE
        it.skip("should have correct number of validator clients");

        describe("validator - n", () => {
          it("should have correct status");
          it("should have correct number of keys loaded");
        });
      });
    }

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

export function participationAssertions(env: SimulationEnvironment): void {
  describe("participation", () => {
    it("should have correct participation on head", async () => {
      const states = await Promise.all(env.nodes.map((n) => n.api.debug.getStateV2("head")));

      for (let n = 0; n < env.params.beaconNodes; n++) {
        // As its end of epoch the "currentEpochParticipation" is all set to zero
        const currentEpochParticipation = (states[n].data as altair.BeaconState).currentEpochParticipation;
        // Make sure the its not end of epoch
        expect(currentEpochParticipation.every((p) => p === 0)).to.be.eql(
          true,
          `Node ${n} has not set current epoch participation to zero. Probably its not the end of epoch.`
        );

        const participationRate = computeAttestationParticipation(states[n].data as altair.BeaconState, "HEAD");
        console.log(`Current participation rate on head: ${participationRate}`);
        expect(participationRate).to.be.gt(env.acceptableParticipationRate, `node ${n} has too low participation rate`);
      }
    });

    it("should have correct participation on FFG", async () => {
      const states = await Promise.all(env.nodes.map((n) => n.api.debug.getStateV2("head")));

      for (let n = 0; n < env.params.beaconNodes; n++) {
        // As its end of epoch the "currentEpochParticipation" is all set to zero
        const currentEpochParticipation = (states[n].data as altair.BeaconState).currentEpochParticipation;
        // Make sure the its not end of epoch
        expect(currentEpochParticipation.every((p) => p === 0)).to.be.eql(
          true,
          `Node ${n} has not set current epoch participation to zero. Probably its not the end of epoch.`
        );

        const participationRate = computeAttestationParticipation(states[n].data as altair.BeaconState, "FFG");
        console.log(`Current participation rate on FFG: ${participationRate}`);
        expect(participationRate).to.be.gt(env.acceptableParticipationRate, `node ${n} has too low participation rate`);
      }
    });
  });
}

export function missedBlocksAssertions(env: SimulationEnvironment): void {
  describe("missing blocks", () => {
    it("should have no missed blocks", async () => {
      const missedBlocks: Record<number, number[]> = {};

      for (let n = 0; n < env.params.beaconNodes; n++) {
        missedBlocks[n] = [];
        for (let i = 0; i < env.clock.currentSlot; i++) {
          try {
            await env.nodes[n].api.beacon.getBlock(i);
          } catch (err) {
            if ((err as HttpError).status === 404) {
              missedBlocks[n].push(i);
            } else {
              throw err;
            }
          }
        }
      }

      // If there is single node
      if (env.params.beaconNodes === 1) {
        expect(missedBlocks[0]).to.be.eql([], `node 0 has following missed blocks: ${missedBlocks[0]}`);
      } else {
        const missedBlocksOnFirstNode = missedBlocks[0];

        for (let n = 1; n < env.params.beaconNodes; n++) {
          expect(missedBlocks[n]).to.deep.equal(
            missedBlocksOnFirstNode,
            `node ${n} has different missed blocks than node 0, missedBlocksOnFirstNode: ${missedBlocksOnFirstNode.join()}, missedBlocksOnNode${n}: ${missedBlocks[
              n
            ].join()}`
          );
        }
      }
    });
  });
}
