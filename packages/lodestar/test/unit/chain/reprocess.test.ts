import {expect} from "chai";
import {ReprocessController} from "../../../src/chain/reprocess";

describe("ReprocessController", function () {
  let controller: ReprocessController;

  beforeEach(() => {
    controller = new ReprocessController(null);
  });

  it("Block not found after 1 slot - returns false", async () => {
    const promise = controller.waitForBlockOfAttestation(100, "A");
    controller.onSlot(101);
    expect(await promise).to.be.equal(false);
  });

  it("Block found too late - returns false", async () => {
    const promise = controller.waitForBlockOfAttestation(100, "A");
    controller.onBlockImported({slot: 100, root: "A"}, 101);
    controller.onSlot(101);
    expect(await promise).to.be.equal(false);
  });

  it("Too many promises - returns false", async () => {
    for (let i = 0; i < 16_384; i++) {
      void controller.waitForBlockOfAttestation(100, "A");
    }
    const promise = controller.waitForBlockOfAttestation(100, "A");
    expect(await promise).to.be.equal(false);
  });

  it("Block comes on time - returns true", async () => {
    const promise = controller.waitForBlockOfAttestation(100, "A");
    controller.onBlockImported({slot: 100, root: "A"}, 100);
    expect(await promise).to.be.equal(true);
  });
});
