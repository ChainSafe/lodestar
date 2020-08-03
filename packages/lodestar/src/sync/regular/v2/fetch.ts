import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconChain} from "../../../chain";
import {INetwork, IReqResp} from "../../../network";
import PeerId from "peer-id";
import {ISlotRange} from "../../interface";
import {Root, SignedBeaconBlock, Status} from "@chainsafe/lodestar-types";
import {sleep} from "../../../util/sleep";
import {getBlockRangeFromPeer, RoundRobinArray} from "../../utils";
import {ZERO_HASH} from "../../../constants";
import {IReputationStore} from "../../reputation";

export function fetchSlotRangeBlocks(
  logger: ILogger,
  chain: IBeaconChain,
  reqResp: IReqResp,
  getPeers: () => Promise<PeerId[]>
): (source: AsyncIterable<ISlotRange[]>,) => AsyncGenerator<SignedBeaconBlock[]> {
  return (source) => {
    return (async function*() {
      for await (const slotRanges of source) {
        let peers = await getPeers();
        let retry = 0;
        while (peers.length === 0 && retry < 5) {
          logger.info("Waiting for peers...");
          await sleep(6000);
          peers = await getPeers();
          retry++;
        }
        if(peers.length === 0) {
          logger.error("Can't find new peers, stopping sync");
          return;
        }
        for (const slotRange of slotRanges) {
          yield getBlockRangeFromPeers(
            reqResp,
            logger,
            peers,
            slotRange
          );
        }
      }
    })();
  };
}

export async function getBlockRangeFromPeers(
  rpc: IReqResp, logger: ILogger, peers: PeerId[], chunk: ISlotRange
): Promise<SignedBeaconBlock[]> {
  logger.info("Fetching block chunks", {validPeerCount: peers.length});
  const peerBalancer = new RoundRobinArray(peers);
  const peer = peerBalancer.next();
  while(peer) {
    let retryCount = 0;
    while (retryCount < 2) {
      try {
        return await getBlockRangeFromPeer(rpc, peer, chunk);
      } catch(e) {
        logger.warn(
          "Failed to get block range from peer",
          {peer: peer.toB58String(), slotRange: JSON.stringify(chunk), retryCount}
        );
      }
      retryCount++;
    }

  }
  return [];
}

export async function getBestHead(
  reps: IReputationStore, network: INetwork, logger: ILogger, currentStatus: Status
): Promise<{slot: number; root: Root}> {
  // await syncPeersStatus(reps, network, logger, currentStatus);
  return network.getPeers().map((peerId) => {
    const latestStatus = reps.get(peerId.toB58String()).latestStatus;
    return latestStatus? {slot: latestStatus.headSlot, root: latestStatus.headRoot} : {slot: 0, root: ZERO_HASH};
  }).reduce((head, peerStatus) => {
    return peerStatus.slot > head.slot? peerStatus : head;
  }, {slot: currentStatus.headSlot, root: currentStatus.headRoot});
}
