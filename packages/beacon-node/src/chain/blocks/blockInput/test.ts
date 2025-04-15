import {ForkPostDeneb} from "@lodestar/params";
import {SignedBeaconBlock} from "@lodestar/types";
import {BlockInput, BlockInputBlobs, BlockInputColumns, BlockInputPreData} from "./blockInput.js";
import {BlockInputBlobsProps, BlockInputColumnsProps} from "./types.js";
import {isBlockInputBlobs, isBlockInputColumns, isBlockInputPreDeneb} from "./utils.js";

export function testTypes(): void {
  const blockInputs: BlockInput[] = [];

  blockInputs.push(new BlockInputPreData({} as any));
  blockInputs.push(new BlockInputBlobs({} as any));
  blockInputs.push(new BlockInputColumns({} as any));

  for (const blockInput of blockInputs) {
    if (isBlockInputPreDeneb(blockInput)) {
      blockInputs.push(blockInput);
    } else if (isBlockInputBlobs(blockInput)) {
      blockInputs.push(blockInput);
    } else if (isBlockInputColumns(blockInput)) {
      blockInputs.push(blockInput);
    }
  }
}
