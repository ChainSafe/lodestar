import {vi, Mocked} from "vitest";
import {ShufflingCache} from "../../src/chain/shufflingCache.js";

export type MockedShufflingCache = Mocked<ShufflingCache>;

vi.mock("../../src/chain/shufflingCache.js");

export function getMockedShufflingCache(): MockedShufflingCache {
  return vi.mocked(new ShufflingCache({} as any));
}
