import {expect} from "chai";
import {groupDepositEventsByBlock} from "../../../../src/eth1/impl/util";
import {IDepositEvent} from "../../../../src/eth1";

describe("utils of eth1", function() {
  it("should return deposit events by block", () => {
    const depositData = {amount:BigInt(0), signature: Buffer.alloc(96), withdrawalCredentials: Buffer.alloc(32), pubkey: Buffer.alloc(48)};
    const depositEvents: IDepositEvent[] = [
      {blockNumber: 1, index: 0, ...depositData},
      {blockNumber: 2, index: 2, ...depositData},
      {blockNumber: 2, index: 1, ...depositData},
      {blockNumber: 3, index: 4, ...depositData},
      {blockNumber: 3, index: 3, ...depositData},
    ];
    const blockEvents = groupDepositEventsByBlock(depositEvents, 0, 4);
    expect(Array.from(blockEvents.keys())).to.be.deep.equals([0, 1, 2, 3, 4]);
    expect(blockEvents.get(0).length).to.be.equal(0);
    expect(blockEvents.get(1).length).to.be.equal(1);
    expect(blockEvents.get(1)[0].index).to.be.equal(0);
    expect(blockEvents.get(2).length).to.be.equal(2);
    expect(blockEvents.get(2)[0].index).to.be.equal(1);
    expect(blockEvents.get(2)[1].index).to.be.equal(2);
    expect(blockEvents.get(3).length).to.be.equal(2);
    expect(blockEvents.get(3)[0].index).to.be.equal(3);
    expect(blockEvents.get(3)[1].index).to.be.equal(4);
    expect(blockEvents.get(4).length).to.be.equal(0);
  });
});
