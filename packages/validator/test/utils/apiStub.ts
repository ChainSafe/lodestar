import sinon, {SinonSandbox} from "sinon";
import {ApiClientOverRest} from "../../src/api";
import {config} from "@chainsafe/lodestar-config/mainnet";

// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function ApiClientStub(sandbox: SinonSandbox = sinon) {
  const api = ApiClientOverRest(config, "");
  return {
    beacon: {
      ...sandbox.stub(api.beacon),
      state: sandbox.stub(api.beacon.state),
      blocks: sandbox.stub(api.beacon.blocks),
      pool: sandbox.stub(api.beacon.pool),
    },
    node: sandbox.stub(api.node),
    validator: sandbox.stub(api.validator),
    events: sandbox.stub(api.events),
    config: sandbox.stub(api.config),
  };
}
