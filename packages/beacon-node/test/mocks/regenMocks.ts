import {vi, Mocked} from "vitest";
import {QueuedStateRegenerator} from "../../src/chain/regen/index.js";

export type MockedQueuedStateRegenerator = Mocked<QueuedStateRegenerator>;

vi.mock("../../src/chain/regen/index.js");

export function getMockedQueuedStateRegenerator(): MockedQueuedStateRegenerator {
  return vi.mocked(new QueuedStateRegenerator({} as any));
}
