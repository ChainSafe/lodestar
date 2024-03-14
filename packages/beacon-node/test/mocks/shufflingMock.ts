import {vi, Mocked} from "vitest";
// eslint-disable-next-line import/no-relative-packages
import {IShufflingCache, ShufflingCache} from "../../../state-transition/src/cache/shufflingCache.js";

vi.mock("../../../state-transition/src/cache/shufflingCache.js");

export function getMockedShufflingCache(): Mocked<IShufflingCache> {
  return vi.mocked(new ShufflingCache({} as any));
}
