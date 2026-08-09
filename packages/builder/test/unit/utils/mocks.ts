import {routes} from "@lodestar/api";
import {BuilderIndex, ssz} from "@lodestar/types";
import {ApiClientStub, mockApiResponse} from "./apiStub.js";

export function mockGetStateBuildersResponse(
  index: BuilderIndex,
  status: routes.beacon.BuilderStatus = "active",
  balance = 1,
  version = 0
): Awaited<ReturnType<ApiClientStub["beacon"]["getStateBuilders"]>> {
  const builder = ssz.gloas.Builder.defaultValue();
  builder.balance = balance;
  builder.version = version;
  return mockApiResponse({
    data: [{index, status, builder}],
    meta: {executionOptimistic: true, finalized: false},
  });
}
