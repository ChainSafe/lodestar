import {itBench} from "@dapplion/benchmark";
import {PeerId} from "@libp2p/interface-peer-id";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {ATTESTATION_SUBNET_COUNT, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {altair, phase0} from "@lodestar/types";
import {defaultNetworkOptions} from "../../../../../src/network/options.js";
import {prioritizePeers, RequestedSubnet} from "../../../../../src/network/peers/utils/index.js";
import {getAttnets, getSyncnets} from "../../../../utils/network.js";

describe("prioritizePeers", () => {
  const seedPeers: {id: PeerId; attnets: phase0.AttestationSubnets; syncnets: altair.SyncSubnets; score: number}[] = [];

  before(async function () {
    for (let i = 0; i < defaultNetworkOptions.maxPeers; i++) {
      const peer = await createSecp256k1PeerId();
      peer.toString = () => `peer-${i}`;
      seedPeers.push({
        id: peer,
        attnets: getAttnets([]),
        syncnets: getSyncnets([]),
        // to be populated later
        score: 0,
      });
    }
  });

  const testCases: {
    lowestScore: number;
    highestScore: number;
    requestedAttnets: {start: number; count: number};
    requestedSyncNets: {start: number; count: number};
    attnetPercentage: number;
    syncnetPercentage: number;
  }[] = [
    {
      lowestScore: -10,
      highestScore: 0,
      requestedAttnets: {start: 0, count: 32},
      requestedSyncNets: {start: 0, count: 2},
      attnetPercentage: 0.1,
      syncnetPercentage: 0,
    },
    {
      lowestScore: 0,
      highestScore: 0,
      requestedAttnets: {start: 0, count: 32},
      requestedSyncNets: {start: 0, count: 2},
      attnetPercentage: 0.25,
      syncnetPercentage: 0.25,
    },
    {
      lowestScore: 0,
      highestScore: 0,
      requestedAttnets: {start: 32, count: 32},
      requestedSyncNets: {start: 0, count: 2},
      attnetPercentage: 0.5,
      syncnetPercentage: 0.5,
    },
    {
      lowestScore: 0,
      highestScore: 0,
      requestedAttnets: {start: 0, count: 64},
      requestedSyncNets: {start: 0, count: 4},
      attnetPercentage: 0.75,
      syncnetPercentage: 0.75,
    },
    {
      lowestScore: 0,
      highestScore: 0,
      requestedAttnets: {start: 0, count: 64},
      requestedSyncNets: {start: 0, count: 4},
      attnetPercentage: 1,
      syncnetPercentage: 1,
    },
  ];

  for (const {
    lowestScore,
    highestScore,
    requestedAttnets,
    requestedSyncNets,
    attnetPercentage,
    syncnetPercentage,
  } of testCases) {
    itBench({
      id: `prioritizePeers score ${lowestScore}:${highestScore} att ${requestedAttnets.count}-${attnetPercentage} sync ${requestedSyncNets.count}-${syncnetPercentage}`,
      beforeEach: () => {
        /**
         * Percentage of active attnet per peer starting from 0.
         * The worse prune scenario is when we have too many subnet peers that's too grouped in some subnets
         * No peer with no long-lived subnets
         * No peer with bad score
         **/
        const connectedPeers = seedPeers.map((peer, i) => ({
          ...peer,
          attnets: getAttnets(
            Array.from({length: Math.floor(attnetPercentage * ATTESTATION_SUBNET_COUNT)}, (_, i) => i)
          ),
          syncnets: getSyncnets(
            Array.from({length: Math.floor(syncnetPercentage * SYNC_COMMITTEE_SUBNET_COUNT)}, (_, i) => i)
          ),
          score: lowestScore + ((highestScore - lowestScore) * i) / defaultNetworkOptions.maxPeers,
        }));

        const attnets: RequestedSubnet[] = [];
        for (let i = 0; i < requestedAttnets.count; i++) {
          attnets.push({subnet: requestedAttnets.start + i, toSlot: 1_000_000});
        }

        const syncnets: RequestedSubnet[] = [];
        for (let i = 0; i < requestedSyncNets.count; i++) {
          syncnets.push({subnet: requestedSyncNets.start + i, toSlot: 1_000_000});
        }
        return {connectedPeers, attnets, syncnets};
      },
      fn: ({connectedPeers, attnets, syncnets}) => {
        prioritizePeers(connectedPeers, attnets, syncnets, defaultNetworkOptions);
      },
    });
  }
});
