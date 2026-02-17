#!/usr/bin/env node

/**
 * EIP-8025 Dummy Prover
 *
 * Subscribes to beacon node head events and submits dummy execution proofs
 * for each new block. Used for devnet/interop testing.
 *
 * Usage:
 *   node scripts/dummy-prover.mjs [options]
 *
 * Options:
 *   --beacon-node URL        Beacon node HTTP endpoint (default: http://localhost:5052)
 *   --proofs-per-block N     Number of proof IDs to submit per block (default: 1, max: 8)
 *   --proof-delay-ms N       Simulated proof generation delay in ms (default: 1000)
 *   --backfill-slots N       Backfill this many recent slots on startup (default: 0)
 */

import {randomBytes} from "node:crypto";

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return defaultValue;
  return args[idx + 1];
}

const BEACON_NODE = getArg("--beacon-node", "http://localhost:5052");
const PROOFS_PER_BLOCK = Math.min(8, Math.max(1, parseInt(getArg("--proofs-per-block", "1"), 10)));
const PROOF_DELAY_MS = parseInt(getArg("--proof-delay-ms", "1000"), 10);
const BACKFILL_SLOTS = parseInt(getArg("--backfill-slots", "0"), 10);

console.log(`Dummy Prover starting...`);
console.log(`  beacon-node:      ${BEACON_NODE}`);
console.log(`  proofs-per-block: ${PROOFS_PER_BLOCK}`);
console.log(`  proof-delay-ms:   ${PROOF_DELAY_MS}`);
console.log(`  backfill-slots:   ${BACKFILL_SLOTS}`);

/**
 * Generate dummy proof data (random bytes).
 * In a real prover, this would be a ZK proof.
 */
function generateDummyProofData(size = 256) {
  return "0x" + randomBytes(size).toString("hex");
}

/**
 * Fetch a block from the beacon node and extract execution payload info.
 */
async function fetchBlock(blockId) {
  const resp = await fetch(`${BEACON_NODE}/eth/v2/beacon/blocks/${blockId}`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch block ${blockId}: ${resp.status} ${resp.statusText}`);
  }
  const json = await resp.json();
  const block = json.data.message || json.data;
  const slot = parseInt(block.slot, 10);
  const executionPayload = block.body?.execution_payload;

  if (!executionPayload) {
    return null; // Pre-merge block
  }

  return {
    slot,
    blockHash: executionPayload.block_hash,
  };
}

/**
 * Submit an execution proof to the beacon node via REST API.
 */
async function submitProof(proof) {
  const resp = await fetch(`${BEACON_NODE}/eth/v1/beacon/pool/execution_proofs`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(proof),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to submit proof: ${resp.status} ${text}`);
  }
}

/**
 * Generate and submit dummy proofs for a block.
 */
async function handleBlock(slot, blockRoot) {
  try {
    const blockInfo = await fetchBlock(blockRoot);
    if (!blockInfo) {
      console.log(`  [slot ${slot}] No execution payload, skipping`);
      return;
    }

    // Simulate proof generation delay
    if (PROOF_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, PROOF_DELAY_MS));
    }

    for (let proofId = 0; proofId < PROOFS_PER_BLOCK; proofId++) {
      const proof = {
        proof_id: proofId,
        slot: String(slot),
        block_hash: blockInfo.blockHash,
        block_root: blockRoot,
        proof_data: generateDummyProofData(256),
      };

      try {
        await submitProof(proof);
        console.log(`  [slot ${slot}] Submitted proof id=${proofId}`);
      } catch (e) {
        console.error(`  [slot ${slot}] Failed proof id=${proofId}: ${e.message}`);
      }
    }
  } catch (e) {
    console.error(`  [slot ${slot}] Error: ${e.message}`);
  }
}

/**
 * Backfill proofs for recent slots.
 */
async function backfill(numSlots) {
  if (numSlots <= 0) return;

  console.log(`Backfilling ${numSlots} recent slots...`);

  const resp = await fetch(`${BEACON_NODE}/eth/v1/beacon/headers/head`);
  if (!resp.ok) {
    console.error(`Failed to fetch head: ${resp.status}`);
    return;
  }
  const json = await resp.json();
  const headSlot = parseInt(json.data.header.message.slot, 10);
  const startSlot = Math.max(0, headSlot - numSlots + 1);

  for (let slot = startSlot; slot <= headSlot; slot++) {
    try {
      const headerResp = await fetch(`${BEACON_NODE}/eth/v1/beacon/headers/${slot}`);
      if (!headerResp.ok) continue;
      const headerJson = await headerResp.json();
      const blockRoot = headerJson.data.root;
      console.log(`Backfill slot ${slot} root=${blockRoot.substring(0, 10)}...`);
      await handleBlock(slot, blockRoot);
    } catch (e) {
      console.error(`Backfill slot ${slot} error: ${e.message}`);
    }
  }
  console.log("Backfill complete.");
}

/**
 * Subscribe to SSE events using fetch streaming.
 * Handles reconnection automatically.
 */
async function subscribeToEvents(onEvent) {
  const url = `${BEACON_NODE}/eth/v1/events?topics=head`;
  console.log(`Subscribing to events: ${url}`);

  while (true) {
    try {
      const resp = await fetch(url, {
        headers: {Accept: "text/event-stream"},
        signal: AbortSignal.timeout(0), // no timeout for streaming
      });

      if (!resp.ok) {
        console.error(`SSE connection failed: ${resp.status}`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";
      let currentData = "";

      while (true) {
        const {done, value} = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            currentData += line.slice(6);
          } else if (line === "") {
            // Empty line = end of event
            if (currentEvent && currentData) {
              onEvent(currentEvent, currentData);
            }
            currentEvent = "";
            currentData = "";
          }
        }
      }

      console.log("SSE stream ended, reconnecting...");
    } catch (e) {
      if (e.name === "AbortError") continue;
      console.error(`SSE error: ${e.message}, reconnecting in 2s...`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/**
 * Main: wait for beacon node, backfill, then subscribe to events.
 */
async function main() {
  // Wait for beacon node to be ready
  let ready = false;
  while (!ready) {
    try {
      const resp = await fetch(`${BEACON_NODE}/eth/v1/node/health`);
      if (resp.ok || resp.status === 206) {
        ready = true;
      } else {
        console.log(`Waiting for beacon node (status=${resp.status})...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch {
      console.log("Waiting for beacon node...");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.log("Beacon node ready.");

  // Backfill if requested
  await backfill(BACKFILL_SLOTS);

  // Subscribe to head events
  await subscribeToEvents((event, data) => {
    if (event !== "head") return;

    try {
      const parsed = JSON.parse(data);
      const slot = parseInt(parsed.slot, 10);
      const blockRoot = parsed.block;
      console.log(`New head: slot=${slot} root=${blockRoot.substring(0, 10)}...`);
      handleBlock(slot, blockRoot);
    } catch (e) {
      console.error(`Event parse error: ${e.message}`);
    }
  });
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
