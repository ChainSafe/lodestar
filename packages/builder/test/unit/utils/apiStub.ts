import {vi} from "vitest";
import {ApiClientStub} from "@lodestar/test-utils/apiStub";

export {type ApiClientStub, mockApiErrorResponse, mockApiResponse} from "@lodestar/test-utils/apiStub";

export function getApiClientStub(): ApiClientStub {
  return {
    beacon: {
      getStateBuilders: vi.fn(),
    },
    node: {
      getSyncingStatus: vi.fn(),
    },
  } as unknown as ApiClientStub;
}
