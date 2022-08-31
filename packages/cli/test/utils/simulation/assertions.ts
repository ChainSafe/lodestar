import {expect} from "chai";
import {SimulationEnvironment} from "./SimulationEnvironment.js";
import {waitForSlot} from "./utils.js";

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

          await env.clock.waitForEndOfEpoch(1);

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

export function forkAssertions(env: SimulationEnvironment): void {
  describe("forks", () => {
    for (let n = 0; n < env.params.beaconNodes; n++) {
      describe(`beacon node "${n}"`, () => {
        describe("altair fork", () => {
          it("should occur on right slot", async () => {
            // const node = env.nodes[n];

            if (env.params.altairEpoch === Infinity) {
              return;
            }

            const expectedSlot = env.params.altairEpoch * env.params.slotsPerEpoch + env.params.genesisSlotsDelay;
            await waitForSlot(env.params, expectedSlot);

            // await node.api.getBlock();
            // Match if the block is from the right fork
          });
        });

        describe("bellatrix fork", () => {
          it("should occur on right slot", async () => {
            // const node = env.nodes[n];

            if (env.params.bellatrixEpoch === Infinity) {
              return;
            }

            const expectedSlot = env.params.bellatrixEpoch * env.params.slotsPerEpoch + env.params.genesisSlotsDelay;
            await waitForSlot(env.params, expectedSlot);

            // await node.api.getBlock();
            // Match ic the block is from the right fork
          });
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
      const heads = await Promise.all(env.nodes.map((n) => n.api.beacon.getBlockHeaders({})));

      expect(heads.length).to.equal(env.params.beaconNodes);
      expect(new Set(heads.map((h) => h.data.length))).to.have.lengthOf(1);
      expect(new Set(heads.map((h) => h.data[0].root))).to.have.lengthOf(1);
    });

    it("all nodes should have same finality checkpoints on the head", async () => {
      const checkpoints = await Promise.all(env.nodes.map((n) => n.api.beacon.getStateFinalityCheckpoints("head")));

      expect(checkpoints.length).to.equal(env.params.beaconNodes);
      expect(new Set(checkpoints.map((h) => h.data.currentJustified.root))).to.have.lengthOf(1);
      expect(new Set(checkpoints.map((h) => h.data.finalized.root))).to.have.lengthOf(1);
      expect(new Set(checkpoints.map((h) => h.data.previousJustified))).to.have.lengthOf(1);
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
    for (let n = 0; n < env.params.beaconNodes; n++) {
      describe(`beacon node "${n}"`, () => {
        it("should have correct participation rate");
      });
    }
  });
}

export function missedBlocksAssertions(env: SimulationEnvironment): void {
  describe("missing blocks", () => {
    before(async () => {
      // Wait for end of one epoch
      console.log(`Waiting for end of epoch ${env.clock.currentEpoch + 1}`);
      await env.clock.waitForEndOfEpoch(env.clock.currentEpoch + 1);
    });

    for (let n = 0; n < env.params.beaconNodes; n++) {
      describe(`beacon node "${n}"`, () => {
        it("should have no missed blocks", async () => {
          let missedBlocks = 0;

          for (let i = 0; i < env.params.slotsPerEpoch * env.clock.currentEpoch; i++) {
            try {
              const block = await env.nodes[n].api.beacon.getBlock(i);
              if (block.data.message.slot !== i) {
                missedBlocks += 1;
              }
            } catch {
              missedBlocks += 1;
            }
          }

          expect(missedBlocks).to.equal(0);
        });
      });
    }
  });
}
