import {vi} from "vitest";
import {ApiClientStub} from "@lodestar/test-utils/apiStub";

export {type ApiClientStub, mockApiErrorResponse, mockApiResponse} from "@lodestar/test-utils/apiStub";

export function getApiClientStub(): ApiClientStub {
  return {
    beacon: {
      getGenesis: vi.fn(),
      getStateBuilders: vi.fn(),
    },
    node: {
      getSyncingStatus: vi.fn(),
      getNodeVersionV2: vi.fn(),
    },
  } as unknown as ApiClientStub;
}
