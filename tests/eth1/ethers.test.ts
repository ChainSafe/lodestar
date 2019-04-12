import BN from "bn.js";
import { assert } from "chai";
import { ethers, Event } from "ethers";
import ganache from "ganache-core";
import sinon from "sinon";

import { EthersEth1Notifier } from "../../src/eth1";
import defaults from "../../src/eth1/defaults";
import promisify from "promisify-es6";
import logger from "../../src/logger/winston";

describe("Eth1Notifier", () => {
  const ganacheProvider = ganache.provider();
  const provider = new ethers.providers.Web3Provider(ganacheProvider);
  const eth1 = new EthersEth1Notifier({
    depositContract: defaults.depositContract,
    provider,
  });

  before(async function() {
    logger.silent(true);
    await eth1.start();
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
  it("should process a new block", async function() {
    this.timeout(0);

    const cb = sinon.spy();
    eth1.on("block", cb);

    await eth1.processBlockHeadUpdate(0);
    assert(cb.calledOnce, "new block event did not fire");
  });

  after(async function() {
    await eth1.stop();
    await promisify(ganacheProvider.close)();
    logger.silent(false);
  })
})
