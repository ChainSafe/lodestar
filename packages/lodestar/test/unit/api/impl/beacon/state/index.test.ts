import {config} from "@chainsafe/lodestar-config/minimal";

import sinon from "sinon";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {BeaconChain} from "../../../../../../src/chain/chain";

beforeEach(function () {
  this.sandbox = sinon.createSandbox();
  this.dbStub = new StubbedBeaconDb(sinon, config);
  this.chainStub = this.sandbox.createStubInstance(BeaconChain);
});
