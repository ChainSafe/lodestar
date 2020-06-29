import {expect} from "chai";
import {groupDepositEventsByBlock} from "../../../../src/eth1/impl/util";
import {IDepositEvent} from "../../../../src/eth1";

describe("utils of eth1", function() {
  it("should return empty array", () => {
    expect(Array.from(groupDepositEventsByBlock(null).keys())).to.be.deep.equal([]);
    expect(Array.from(groupDepositEventsByBlock([]).keys())).to.be.deep.equal([]);
  });

  it("should return deposit events by block", () => {
    const depositData = {amount: 0n, signature: Buffer.alloc(96), withdrawalCredentials: Buffer.alloc(32), pubkey: Buffer.alloc(48)};
    const depositEvents: IDepositEvent[] = [
      {blockNumber: 1000, index: 0, ...depositData},
      {blockNumber: 2000, index: 2, ...depositData},
      {blockNumber: 2000, index: 1, ...depositData},
      {blockNumber: 3000, index: 4, ...depositData},
      {blockNumber: 3000, index: 3, ...depositData},
    ];
    const blockEvents = groupDepositEventsByBlock(depositEvents);
    expect(Array.from(blockEvents.keys())).to.be.deep.equals([1000, 2000, 3000]);
    expect(blockEvents.get(1000).length).to.be.equal(1);
    expect(blockEvents.get(1000)[0].index).to.be.equal(0);
    expect(blockEvents.get(2000).length).to.be.equal(2);
    expect(blockEvents.get(2000)[0].index).to.be.equal(1);
    expect(blockEvents.get(2000)[1].index).to.be.equal(2);
    expect(blockEvents.get(3000).length).to.be.equal(2);
    expect(blockEvents.get(3000)[0].index).to.be.equal(3);
    expect(blockEvents.get(3000)[1].index).to.be.equal(4);

  });
});