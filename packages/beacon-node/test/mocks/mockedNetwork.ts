import {vi, Mocked} from "vitest";
import {Network, INetwork} from "../../src/network/index.js";

vi.mock("../../src/network/index.js", async (importActual) => {
  const mod = await importActual<typeof import("../../src/network/index.js")>();

  const Network = vi.fn().mockImplementation(() => {
    return {};
  });

  return {
    ...mod,
    Network,
  };
});

export type MockedNetwork = Mocked<INetwork>;

export function getMockedNetwork(): MockedNetwork {
  return new Network({} as any) as unknown as MockedNetwork;
}
