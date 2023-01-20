import {getClient, ApiError} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {getInfuraBeaconUrl} from "../utils/infura.js";

// Analyze how Ethereum Consensus blocks are in a target network to prepare accurate performance states and blocks

// Mainnet
// slot: 1803658,
// blocks: 2790,
// attestationsPerBlock: 89.79820788530466,
// depositsPerBlock: 0.005017921146953405,
// attesterSlashingsPerBlock: 0,
// proposerSlashingsPerBlock: 0,
// voluntaryExitsPerBlock: 0,
// inclusionDistanceAvg: 3.446696495926749,
// aggregationBitsAvg: 87.88991645944512

const network = "mainnet";
const client = getClient({baseUrl: getInfuraBeaconUrl(network)}, {config});

async function run(): Promise<void> {
  const res = await client.beacon.getBlockHeader("head");
  ApiError.assert(res);
  const headBlock = res.response.data;

  // Count operations
  let blocks = 0;
  let attestations = 0;
  let deposits = 0;
  let attesterSlashings = 0;
  let proposerSlashings = 0;
  let voluntaryExits = 0;

  // Analyze attestations
  let inclusionDistance = 0;
  let aggregationBits = 0;

  const startSlot = headBlock.header.message.slot;
  const batchSize = 32;

  for (let slot = startSlot; slot > 0; slot -= batchSize) {
    const blockPromises: ReturnType<typeof client.beacon.getBlock>[] = [];
    for (let s = slot - batchSize; s < slot; s++) {
      blockPromises.push(client.beacon.getBlock(s));
    }

    const results = await Promise.allSettled(blockPromises);
    for (const result of results) {
      if (result.status === "rejected") {
        // Missed block
        continue;
      }
      ApiError.assert(result.value);

      const block = result.value.response.data;

      blocks++;
      attestations += block.message.body.attestations.length;
      deposits += block.message.body.deposits.length;
      attesterSlashings += block.message.body.attesterSlashings.length;
      proposerSlashings += block.message.body.proposerSlashings.length;
      voluntaryExits += block.message.body.voluntaryExits.length;

      for (const attestation of block.message.body.attestations) {
        const indexes = Array.from({length: attestation.aggregationBits.bitLen}, () => 0);
        aggregationBits += attestation.aggregationBits.intersectValues(indexes).length;
        inclusionDistance += block.message.slot - attestation.data.slot;
      }
    }

    /* eslint-disable no-console */
    console.log({
      slot,
      blocks,
      attestationsPerBlock: attestations / blocks,
      depositsPerBlock: deposits / blocks,
      attesterSlashingsPerBlock: attesterSlashings / blocks,
      proposerSlashingsPerBlock: proposerSlashings / blocks,
      voluntaryExitsPerBlock: voluntaryExits / blocks,
      inclusionDistanceAvg: inclusionDistance / attestations,
      aggregationBitsAvg: aggregationBits / attestations,
    });
  }
}

run().catch((e: Error) => {
  console.error(e);
  process.exit(1);
});
