import {config} from "@chainsafe/lodestar-config/default";
import {generateSignedBlock} from "../../../utils/block";
import {groupBlocksByEpoch} from "../../../../src/chain/blocks/util";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {expect} from "chai";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";

describe("chain / blocks / util / groupBlocksByEpoch", function () {
  const fastConfig: IBeaconConfig = config;

  const testCases: {id: string; blocksSlot: number[]; blocksByEpochSlot: number[][]}[] = [
    {
      id: "Regular segment with all slots",
      blocksSlot: Array.from({length: SLOTS_PER_EPOCH * 2}, (_, i) => i),
      blocksByEpochSlot: [
        Array.from({length: SLOTS_PER_EPOCH}, (_, i) => i),
        Array.from({length: SLOTS_PER_EPOCH}, (_, i) => i + SLOTS_PER_EPOCH),
      ],
    },
    {
      id: "Regular segment with skipped slots",
      blocksSlot: Array.from({length: SLOTS_PER_EPOCH * 2}, (_, i) => i).filter((i) => ![5, 6, 11, 13, 19].includes(i)),
      blocksByEpochSlot: [
        Array.from({length: SLOTS_PER_EPOCH}, (_, i) => i).filter((i) => ![5, 6, 11, 13, 19].includes(i)),
        Array.from({length: SLOTS_PER_EPOCH}, (_, i) => i + SLOTS_PER_EPOCH).filter(
          (i) => ![5, 6, 11, 13, 19].includes(i)
        ),
      ],
    },
    {
      id: "Empty epoch",
      blocksSlot: [0, 1, 2, 3, 8, 9, 10, 11],
      blocksByEpochSlot: [
        [0, 1, 2, 3],
        [8, 9, 10, 11],
      ],
    },
    {
      id: "Empty segment",
      blocksSlot: [],
      blocksByEpochSlot: [],
    },
  ];

  for (const {id, blocksSlot, blocksByEpochSlot} of testCases) {
    it(id, () => {
      const blocks = blocksSlot.map((slot) => generateSignedBlock({message: {slot}}));
      const blocksByEpoch = groupBlocksByEpoch(fastConfig, blocks);

      expect(blocksByEpoch.map((blockInEpoch) => blockInEpoch.map((block) => block.message.slot))).to.deep.equal(
        blocksByEpochSlot
      );
    });
  }
});
