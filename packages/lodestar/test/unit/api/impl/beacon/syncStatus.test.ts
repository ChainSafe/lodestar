import sinon, {SinonStubbedInstance} from "sinon";
import {BeaconChain} from "../../../../../src/chain";
import {BeaconApi, IBeaconApi} from "../../../../../src/api/impl/beacon";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {generateState} from "../../../../utils/state";
import {generateValidator} from "../../../../utils/validator";
import {expect} from "chai";
import {BeaconSync} from "../../../../../src/sync";
import { SyncingStatus } from "@chainsafe/lodestar-types";

describe("get validator details api", function () {

  const sandbox = sinon.createSandbox();

  let syncStub: SinonStubbedInstance<BeaconSync>;

  let api: IBeaconApi;

  beforeEach(function () {
    syncStub = sinon.createStubInstance(BeaconSync);
    // @ts-ignore
    api = new BeaconApi({}, {sync: syncStub, config});
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should return false in case it's synced", async function () {
    syncStub.getSyncStatus.resolves(null);
    const result = await api.getSyncingStatus();
    expect(result).to.be.false;
  });

  it("should return sync status", async function () {
    const status: SyncingStatus = {
      currentBlock:BigInt(1),
      highestBlock:BigInt(10),
      startingBlock:BigInt(0)
    };
    syncStub.getSyncStatus.resolves(status);
    const result = await api.getSyncingStatus();
    expect(config.types.SyncingStatus.equals(result as SyncingStatus, status)).to.be.true;
  });

});
