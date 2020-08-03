import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconChain} from "../../../chain";
import {INetwork, IReqResp} from "../../../network";
import PeerId from "peer-id";
import {ISlotRange} from "../../interface";
import {Root, SignedBeaconBlock, Status} from "@chainsafe/lodestar-types";
import {sleep} from "../../../util/sleep";
import {getBlockRangeFromPeer, RoundRobinArray, syncPeersStatus} from "../../utils";
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
        yield * await Promise.all(
          slotRanges.map(async function(slotRange) {
            return getBlockRangeFromPeers(
              reqResp,
              logger,
              peers,
              slotRange
            );
          })
        );
      }
    })();
  };
}

export async function getBlockRangeFromPeers(
  rpc: IReqResp, logger: ILogger, peers: PeerId[], chunk: ISlotRange
): Promise<SignedBeaconBlock[]> {
  const peerBalancer = new RoundRobinArray(peers);
  const peer = peerBalancer.next();
  while(peer) {
    try {
      return getBlockRangeFromPeer(rpc, peer, chunk);
    } catch(e) {
      logger.warn("Failed to get block range from peer", {peer: peer.toB58String(), slotRange: JSON.stringify(chunk)});
    }
  }
  return [];
}

export async function getBestHead(
  reps: IReputationStore, network: INetwork, logger: ILogger, currentStatus: Status
): Promise<{slot: number; root: Root}> {
  await syncPeersStatus(reps, network, logger, currentStatus);
  return network.getPeers().map((peerId) => {
    const latestStatus = reps.get(peerId.toB58String()).latestStatus;
    return latestStatus? {slot: latestStatus.headSlot, root: latestStatus.headRoot} : {slot: 0, root: ZERO_HASH};
  }).reduce((head, peerStatus) => {
    return peerStatus.slot > head.slot? peerStatus : head;
  }, {slot: currentStatus.headSlot, root: currentStatus.headRoot});
}
