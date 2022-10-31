import sinon, {SinonSandbox} from "sinon";
import {getClient, Api} from "@lodestar/api";
import {config} from "@lodestar/config/default";

export function getApiClientStub(
  sandbox: SinonSandbox = sinon
): Api & {[K in keyof Api]: sinon.SinonStubbedInstance<Api[K]>} {
  const api = getClient({baseUrl: "http://localhost:9596"}, {config});

  return {
    beacon: sandbox.stub(api.beacon),
    config: sandbox.stub(api.config),
    // Typescript errors due to the multiple return types of debug.getState()
    // Since the return type of this function is typed, casting to any to patch the error quickly
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    debug: sandbox.stub(api.debug) as any,
    events: sandbox.stub(api.events),
    lightclient: sandbox.stub(api.lightclient),
    lodestar: sandbox.stub(api.lodestar),
    node: sandbox.stub(api.node),
    validator: sandbox.stub(api.validator),
  };
}
