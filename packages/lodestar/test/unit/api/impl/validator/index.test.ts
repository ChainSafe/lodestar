import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/minimal";
import {StubbedBeaconDb} from "../../../../utils/stub";

beforeEach(function () {
  this.sandbox = sinon.createSandbox();
  this.dbStub = new StubbedBeaconDb(this.sandbox, config);
});
