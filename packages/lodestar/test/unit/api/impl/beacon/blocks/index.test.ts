import {config} from "@chainsafe/lodestar-config/minimal";
import sinon from "sinon";
import {BeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks";
import {ForkChoice, BeaconChain} from "../../../../../../src/chain";
import {Network} from "../../../../../../src/network";
import {BeaconSync} from "../../../../../../src/sync";
import {StubbedBeaconDb} from "../../../../../utils/stub";

beforeEach(function () {
  this.sandbox = sinon.createSandbox();
  this.forkChoiceStub = sinon.createStubInstance(ForkChoice);
  this.chainStub = sinon.createStubInstance(BeaconChain);
  this.syncStub = sinon.createStubInstance(BeaconSync);
  this.chainStub.forkChoice = this.forkChoiceStub;
  this.dbStub = new StubbedBeaconDb(sinon, config);
  this.networkStub = sinon.createStubInstance(Network);

  this.blockApi = new BeaconBlockApi(
    {},
    {
      chain: this.chainStub,
      config,
      db: this.dbStub,
      network: this.networkStub,
      sync: this.syncStub,
    }
  );
});

afterEach(function () {
  this.sandbox.restore();
});
