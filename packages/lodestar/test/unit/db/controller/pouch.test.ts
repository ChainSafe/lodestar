import {assert, expect} from "chai";
import {PouchDbController} from "../../../../src/db/controller";
import {WinstonLogger} from "../../../../src/logger";

describe("PouchDB controller", () => {
  const db = new PouchDbController({name: 'testDb'});
  let logger = new WinstonLogger();

  before(async () => {
    logger.silent = true;
    await db.start();
  });

  after(async () => {
    await db.stop();
    logger.silent = false;
  });

  it('test put', async () => {
    await db.put('test', 'some value');
    assert(true);
  });

  it('test get', async () => {
    await db.put('test1', 'some value');
    const value = await db.get('test1');
    expect(value.toString('utf8')).to.be.equal('some value');
  });

  it('test batchPut', async () => {
    await db.batchPut([
      {
        key: 'test3',
        value: 'value'
      },
      {
        key: 'test3',
        value: 'value'
      }
    ]);
    expect(true);
  });

  it('test search', async () => {
    await db.batchPut([
      {
        key: 'search1',
        value: 'value'
      },
      {
        key: 'search2',
        value: 'value'
      }
    ]);
    const result = await db.search({
      gt: 'search0',
      lt: 'search99'
    });
    expect(result.length).to.be.equal(2);
  });

  it('test batch delete', async () => {
    await db.batchPut([
      {
        key: 'search1',
        value: 'value'
      },
      {
        key: 'search2',
        value: 'value'
      }
    ]);
    const result = await db.search({
      gt: 'search0',
      lt: 'search99'
    });
    expect(result.length).to.be.equal(2);
    await db.batchDelete(["search1", "search2"]);
  });

});
