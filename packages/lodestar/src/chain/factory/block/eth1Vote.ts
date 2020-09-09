import {IBeaconDb} from "../../../db";

// Interim solution until eth1 data for block production is fully refactored
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function readEth1VotesFromDb(db: IBeaconDb) {
  return (await db.eth1Data.entries()).map(({key, value}) => ({
    blockHash: value.blockHash,
    depositCount: value.depositCount,
    depositRoot: value.depositRoot,
    timestamp: key,
  }));
}
