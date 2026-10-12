import {afterEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputColumns, BlockInputSource} from "../../../src/chain/blocks/blockInput/index.js";
import {
  PayloadEnvelopeInput,
  PayloadEnvelopeInputSource,
} from "../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {ColumnReconstructionTracker} from "../../../src/chain/ColumnReconstructionTracker.js";
import {ChainEventEmitter} from "../../../src/chain/emitter.js";
import {recoverDataColumnSidecars} from "../../../src/util/dataColumns.js";
import {getMockedLogger} from "../../mocks/loggerMock.js";

vi.mock("../../../src/util/dataColumns.js", async (importActual) => ({
  ...(await importActual<typeof import("../../../src/util/dataColumns.js")>()),
  recoverDataColumnSidecars: vi.fn().mockResolvedValue(undefined),
}));

describe("ColumnReconstructionTracker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([0, 1])("uses each input's fork for reconstruction delay, random=%i", async (random) => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(random);
    const config = createChainForkConfig({FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 1});
    config.getSlotDurationMs = (fork) => (fork === ForkName.fulu ? 12000 : 6000);
    const emitter = new ChainEventEmitter();
    const tracker = new ColumnReconstructionTracker({config, emitter, metrics: null, logger: getMockedLogger()});

    for (const slot of [SLOTS_PER_EPOCH - 1, SLOTS_PER_EPOCH]) {
      const fork = config.getForkName(slot);
      const props = {
        blockRootHex: toRootHex(Buffer.alloc(32, slot)),
        seenTimestampSec: 0,
        daOutOfRange: false,
        sampledColumns: [],
        custodyColumns: [],
      };
      const fuluBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
      fuluBlock.message.slot = slot;
      const gloasBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      gloasBlock.message.slot = slot;
      const input =
        fork === ForkName.fulu
          ? BlockInputColumns.createFromBlock({
              ...props,
              block: fuluBlock,
              forkName: ForkName.fulu,
              source: BlockInputSource.gossip,
            })
          : PayloadEnvelopeInput.createFromBlock({
              ...props,
              block: gloasBlock,
              forkName: ForkName.gloas,
              source: PayloadEnvelopeInputSource.gossip,
            });
      const delay = fork === ForkName.fulu ? (random === 0 ? 800 : 1200) : random === 0 ? 400 : 600;
      vi.mocked(recoverDataColumnSidecars).mockClear();

      tracker.triggerColumnReconstruction(input);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(recoverDataColumnSidecars, `before reconstruction in slot ${slot}`).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(recoverDataColumnSidecars, `reconstruction in slot ${slot}`).toHaveBeenCalledExactlyOnceWith(
        input,
        emitter,
        null
      );
    }
  });
});
