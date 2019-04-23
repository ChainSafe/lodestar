import chai, {assert, expect} from "chai";
import {Contract, ethers, Event} from "ethers";
import ganache from "ganache-core";
import sinon from "sinon";

import { EthersEth1Notifier } from "../../../src/eth1";
import defaults from "../../../src/eth1/defaults";
import promisify from "promisify-es6";
import logger from "../../../src/logger/winston";
import chaiAsPromised from "chai-as-promised";

chai.use(chaiAsPromised);
describe("Eth1Notifier", () => {
  const ganacheProvider = ganache.provider();
  const provider = new ethers.providers.Web3Provider(ganacheProvider);
  const eth1 = new EthersEth1Notifier({
    depositContract: defaults.depositContract,
    provider,
  });

  before(async function(): Promise<void> {
    logger.silent(true);
  });

  it("should fail to start because there isn't contract at given address",  async function(): Promise<void> {
    await expect(eth1.start()).to.be.rejectedWith('There is no deposit contract at given address');
  });

  it("should process a Deposit log", async function() {
    const cb = sinon.spy();
    eth1.on('deposit', cb);

    const dataHex = "0x" + Buffer.alloc(528).toString("hex");
    const indexHex = "0x" + Buffer.alloc(528).toString("hex");

    eth1.processDepositLog(dataHex, indexHex);
    assert(cb.calledOnce, "deposit event did not fire");
  });

  it("should process a Eth2Genesis log", async function() {
    const cb = sinon.spy();
    eth1.on("eth2genesis", cb);

    const depositRootHex = "0x" + Buffer.alloc(32).toString("hex");
    const depositCountHex = "0x0000000000000000";
    const timeBuf = Buffer.alloc(8);
    const unixTimeNow = Math.floor(Date.now() / 1000);
    timeBuf.writeUInt32LE(unixTimeNow, 0);
    const timeHex = "0x" + timeBuf.toString("hex");
    const event = { blockHash: "0x0000000000000000" } as Event;

    await eth1.processEth2GenesisLog(depositRootHex, depositCountHex, timeHex, event);
    assert(cb.calledOnce, "eth2genesis event did not fire");
  });

  it("should process a new block", async function(): Promise<void> {
    this.timeout(0);

    const cb = sinon.spy();
    eth1.on("block", cb);

    await eth1.processBlockHeadUpdate(0);
    assert(cb.calledOnce, "new block event did not fire");
  });

  it("should get latest block hash", async function(): Promise<void> {
    this.timeout(0);

    await eth1.processBlockHeadUpdate(0);
    expect(eth1.latestBlockHash()).to.not.be.null;
    expect(eth1.latestBlockHash().length).to.be.equal(32);
  });

  it("should get deposit root from contract", async function(): Promise<void> {
    const spy = sinon.stub();
    const contract = {
      // eslint-disable-next-line
      get_deposit_root: spy
    };
    eth1.setContract(contract as any);
    const testDepositRoot = Buffer.alloc(32);
    spy.resolves('0x' + testDepositRoot.toString('hex'));

    const depositRoot = await eth1.depositRoot();
    expect(depositRoot).to.be.deep.equal(testDepositRoot);

  });

  after(async function(): Promise<void> {
    await promisify(ganacheProvider.close)();
    logger.silent(false);
  });
});
