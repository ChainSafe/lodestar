import sinon, {SinonSandbox} from "sinon";
import {getClient, Api} from "@chainsafe/lodestar-api";
import {config} from "@chainsafe/lodestar-config/mainnet";

export function getApiClientStub(
  sandbox: SinonSandbox = sinon
): Api & {[K in keyof Api]: sinon.SinonStubbedInstance<Api[K]>} {
  const api = getClient(config, {baseUrl: ""});

  return {
    beacon: sandbox.stub(api.beacon),
    config: sandbox.stub(api.config),
    debug: sandbox.stub(api.debug),
    events: sandbox.stub(api.events),
    lightclient: sandbox.stub(api.lightclient),
    lodestar: sandbox.stub(api.lodestar),
    node: sandbox.stub(api.node),
    validator: sandbox.stub(api.validator),
  };
}
