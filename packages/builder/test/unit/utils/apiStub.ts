import {vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {ApiClientStub, mockApiResponse} from "@lodestar/test-utils/apiStub";

export {type ApiClientStub, mockApiErrorResponse, mockApiResponse} from "@lodestar/test-utils/apiStub";

export function getApiClientStub(): ApiClientStub {
  return {
    beacon: {
      getGenesis: vi.fn(),
      getStateBuilders: vi.fn(),
      getBlockV2: vi.fn(),
      publishExecutionPayloadBid: vi.fn(),
      publishExecutionPayloadEnvelope: vi.fn(),
      publishBlockV2: vi.fn(),
      getProposerPreferences: vi.fn().mockResolvedValue(mockApiResponse({data: [], meta: {version: ForkName.gloas}})),
    },
    validator: {
      getProposerDutiesV2: vi.fn(),
    },
    events: {
      eventstream: vi.fn(),
    },
    node: {
      getSyncingStatus: vi.fn(),
      getNodeVersionV2: vi.fn(),
    },
  } as unknown as ApiClientStub;
}
