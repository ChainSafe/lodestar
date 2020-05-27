import {expect} from "chai";
import {groupDepositEventsByBlock} from "../../../../src/eth1/impl/util";
import {IDepositEvent} from "../../../../src/eth1";

describe("utils of eth1", function() {
  it("should return empty array", () => {
    expect(groupDepositEventsByBlock(null)).to.be.deep.equal([]);
    expect(groupDepositEventsByBlock([])).to.be.deep.equal([]);
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
    expect(blockEvents.length).to.be.equal(3);
    expect(blockEvents[0][0]).to.be.equal(1000);
    expect(blockEvents[0][1].length).to.be.equal(1);
    expect(blockEvents[1][0]).to.be.equal(2000);
    expect(blockEvents[1][1].length).to.be.equal(2);
    // make sure events are sorted
    expect(blockEvents[1][1][0].index).to.be.lt(blockEvents[1][1][1].index);
    expect(blockEvents[2][0]).to.be.equal(3000);
    expect(blockEvents[2][1].length).to.be.equal(2);
    // make sure events are sorted
    expect(blockEvents[2][1][0].index).to.be.lt(blockEvents[2][1][1].index);
  });
});