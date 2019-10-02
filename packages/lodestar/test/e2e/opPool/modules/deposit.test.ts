import {describe, it, beforeEach, afterEach} from "mocha";
import {OpPool} from "../../../../src/opPool";
import sinon from "sinon";
import {EthersEth1Notifier, IEth1Notifier} from "../../../../src/eth1";
import {BeaconDb, IBeaconDb} from "../../../../src/db/api";
import {LevelDbController} from "../../../../src/db/controller";
import {config} from "@chainsafe/eth2.0-config/src/presets/minimal";
// @ts-ignore
import level from "level";
// @ts-ignore
import leveldown from "leveldown";
import {WinstonLogger} from "../../../../src/logger";
// @ts-ignore
import promisify from "promisify-es6";
import {expect} from "chai";
import {generateDeposit} from "../../../utils/deposit";

describe("opPool - deposits", function () {

  this.timeout(10000);

  const sandbox = sinon.createSandbox();
  const dbLocation = "./.__testdb";
  const eth1 = sandbox.createStubInstance(EthersEth1Notifier) as IEth1Notifier;

  let opPool: OpPool, db: BeaconDb;

  beforeEach(async function () {
    const testDb = level(
      dbLocation, {
        keyEncoding: "binary",
        valueEncoding: "binary",
      });
    db = new BeaconDb({
      config,
      controller: new LevelDbController(
        {db: testDb, name: "test"},
        {logger: sandbox.createStubInstance(WinstonLogger)}
      )
    });
    opPool = new OpPool({}, {eth1, db, config});
    await db.start();
  });

  afterEach(async function () {
    await db.stop();
    await promisify(leveldown.destroy)(dbLocation);
  });

  it("should fetch deposit from range - upper and lower limit",async function () {
    await Promise.all([
      db.deposit.set(0, generateDeposit()),
      db.deposit.set(2, generateDeposit()),
      db.deposit.set(4, generateDeposit()),
      db.deposit.set(6, generateDeposit())
    ]);
    const result = await opPool.deposits.getAllBetween(1, 7);
    expect(result.length).to.be.equal(3);
  });

  it("should fetch deposit from range - upper limit only",async function () {
    await Promise.all([
      db.deposit.set(2, generateDeposit()),
      db.deposit.set(4, generateDeposit()),
      db.deposit.set(6, generateDeposit())
    ]);
    const result = await opPool.deposits.getAllBetween(null, 4);
    expect(result.length).to.be.equal(1);
  });

  it("should fetch deposit from range - lower limit only",async function () {
    await Promise.all([
      db.deposit.set(2, generateDeposit()),
      db.deposit.set(4, generateDeposit()),
      db.deposit.set(6, generateDeposit())
    ]);
    const result = await opPool.deposits.getAllBetween(0, null);
    expect(result.length).to.be.equal(3);
  });

});