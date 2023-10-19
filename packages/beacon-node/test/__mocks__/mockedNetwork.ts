import {vi, MockedObject} from "vitest";
import {Network} from "../../src/network/index.js";

export type MockedNetwork = MockedObject<Network>;

vi.mock("../../src/network/index.js");

export function getMockedNetwork(): MockedNetwork {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  return vi.mocked(new Network()) as MockedNetwork;
}
