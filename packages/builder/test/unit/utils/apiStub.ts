import {vi} from "vitest";
import {ApiClientStub} from "@lodestar/test-utils/apiStub";

export {type ApiClientStub, mockApiErrorResponse, mockApiResponse} from "@lodestar/test-utils/apiStub";

export function getApiClientStub(): ApiClientStub {
  return {
    beacon: {
      getStateBuilders: vi.fn(),
      getBlockV2: vi.fn(),
      publishExecutionPayloadBid: vi.fn(),
      publishExecutionPayloadEnvelope: vi.fn(),
    },
    node: {
      getSyncingStatus: vi.fn(),
    },
    events: {
      eventstream: vi.fn(),
    },
  } as unknown as ApiClientStub;
}
