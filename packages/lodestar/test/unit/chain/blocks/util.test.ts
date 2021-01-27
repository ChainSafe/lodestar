import {config} from "@chainsafe/lodestar-config/minimal";
import {generateSignedBlock} from "../../../utils/block";
import {groupBlocksByEpoch} from "../../../../src/chain/blocks/util";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {expect} from "chai";

describe("chain / blocks / util / groupBlocksByEpoch", function () {
  const SLOTS_PER_EPOCH = 4;
  const fastConfig: IBeaconConfig = {
    ...config,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    params: {...config.params, SLOTS_PER_EPOCH},
  };

  const testCases: {id: string; blocksSlot: number[]; blocksByEpochSlot: number[][]}[] = [
    {
      id: "Regular segment with all slots",
      blocksSlot: [0, 1, 2, 3, 4, 5, 6, 7],
      blocksByEpochSlot: [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
      ],
    },
    {
      id: "Regular segment with skipped slots",
      blocksSlot: [1, 2, 3, 4, 7, 8, 9, 10, 12, 14, 15],
      blocksByEpochSlot: [
        [1, 2, 3],
        [4, 7],
        [8, 9, 10],
        [12, 14, 15],
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
