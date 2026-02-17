#!/usr/bin/env node

// EIP-8025 Devnet Validation Script
// Standalone Node.js script — no dependencies, uses native fetch (Node 18+)

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

function green(s) { return `${GREEN}${s}${RESET}`; }
function red(s) { return `${RED}${s}${RESET}`; }
function yellow(s) { return `${YELLOW}${s}${RESET}`; }
function cyan(s) { return `${CYAN}${s}${RESET}`; }
function bold(s) { return `${BOLD}${s}${RESET}`; }
function dim(s) { return `${DIM}${s}${RESET}`; }

// --- Argument parsing ---

function parseArgs(argv) {
  const args = { urls: null, zkevmIndex: null, waitEpochs: 5 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--urls" && argv[i + 1]) {
      args.urls = argv[++i].split(",").map((u) => u.trim().replace(/\/$/, ""));
    } else if (argv[i] === "--zkevm-index" && argv[i + 1]) {
      args.zkevmIndex = Number(argv[++i]);
    } else if (argv[i] === "--wait-epochs" && argv[i + 1]) {
      args.waitEpochs = Number(argv[++i]);
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`Usage: validate-devnet.mjs [options]

Options:
  --urls <url1,url2,...>   Comma-separated beacon API base URLs
  --zkevm-index <n>         0-based index of the zkEVM node (default: last)
  --wait-epochs <n>        Wait N epochs before checking finality (default: 5)
  -h, --help               Show this help message`);
      process.exit(0);
    }
  }
  return args;
}

// --- HTTP helper ---

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// --- Kurtosis auto-discovery ---

async function discoverUrlsFromKurtosis() {
  const { execSync } = await import("node:child_process");
  let output;
  try {
    output = execSync("kurtosis enclave inspect eip8025-devnet", {
      encoding: "utf-8",
      timeout: 10000,
    });
  } catch {
    throw new Error(
      "Failed to auto-discover beacon URLs from kurtosis. Pass --urls manually."
    );
  }

  // Parse lines that look like: cl-N-...-... http -> http://127.0.0.1:PORT
  const urls = [];
  for (const line of output.split("\n")) {
    const match = line.match(/(?:http:\/\/)?(\d+\.\d+\.\d+\.\d+:\d+)\s*->\s*(?:RUNNING|http)/);
    // Look for beacon API HTTP ports (typically 4000 in kurtosis)
    if (line.includes("cl-") && line.includes("http")) {
      const portMatch = line.match(/(\d+\.\d+\.\d+\.\d+:(\d+))/g);
      if (portMatch) {
        for (const addr of portMatch) {
          // Beacon HTTP API is typically on port 4000 mapped to some host port
          if (!addr.includes(":9000") && !addr.includes(":5054")) {
            urls.push(`http://${addr}`);
            break;
          }
        }
      }
    }
  }

  if (urls.length === 0) {
    throw new Error(
      "Could not find beacon API URLs in kurtosis output. Pass --urls manually."
    );
  }
  return urls;
}

// --- Node label helper ---

function nodeLabel(index, total) {
  // Generic labels since we don't know actual client names from URLs alone
  return `Node ${index + 1}`;
}

// --- Sleep helper ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Section printer ---

function section(title) {
  console.log(`\n${bold(cyan(`--- ${title} ---`))}`)
}

// --- Main checks ---

const failures = [];

function pass(msg) {
  console.log(green(`✅ ${msg}`));
}

function fail(msg) {
  console.log(red(`❌ ${msg}`));
  failures.push(msg);
}

function info(msg) {
  console.log(`  ${msg}`);
}

async function checkChainHealth(urls) {
  section("Chain Health");

  // First round
  const heads1 = await Promise.all(
    urls.map(async (url, i) => {
      try {
        const resp = await fetchJson(`${url}/eth/v1/beacon/headers/head`);
        return resp.data;
      } catch (e) {
        fail(`${nodeLabel(i)} — failed to fetch head: ${e.message}`);
        return null;
      }
    })
  );

  for (let i = 0; i < heads1.length; i++) {
    const h = heads1[i];
    if (!h) continue;
    const slot = Number(h.header.message.slot);
    const epoch = Math.floor(slot / 32);
    const root = h.root.slice(0, 10) + "...";
    info(`${nodeLabel(i)}: head=${slot} epoch=${epoch} root=${root}`);
  }

  // Wait and query again to verify advancing
  console.log(dim("  Waiting 6s to check slot advancement..."));
  await sleep(6000);

  const heads2 = await Promise.all(
    urls.map(async (url) => {
      try {
        const resp = await fetchJson(`${url}/eth/v1/beacon/headers/head`);
        return resp.data;
      } catch {
        return null;
      }
    })
  );

  let allAdvancing = true;
  for (let i = 0; i < heads1.length; i++) {
    if (!heads1[i] || !heads2[i]) { allAdvancing = false; continue; }
    const s1 = Number(heads1[i].header.message.slot);
    const s2 = Number(heads2[i].header.message.slot);
    if (s2 <= s1) {
      fail(`${nodeLabel(i)} head not advancing (${s1} -> ${s2})`);
      allAdvancing = false;
    }
  }

  // Check if all nodes on same head
  const validHeads = heads2.filter(Boolean);
  const uniqueSlots = new Set(validHeads.map((h) => h.header.message.slot));
  if (uniqueSlots.size === 1 && validHeads.length === urls.length) {
    pass("All nodes on same head");
  } else if (uniqueSlots.size > 1) {
    // Allow 1-slot difference (propagation delay)
    const slots = [...uniqueSlots].map(Number).sort((a, b) => a - b);
    if (slots[slots.length - 1] - slots[0] <= 1) {
      pass("All nodes within 1 slot of each other");
    } else {
      fail(`Nodes have divergent heads: slots ${[...uniqueSlots].join(", ")}`);
    }
  }

  if (allAdvancing && validHeads.length === urls.length) {
    pass("Chain is advancing");
  }
}

async function checkFinality(urls, waitEpochs) {
  section("Finality");

  // Poll until finalization or timeout
  const slotsPerEpoch = 32;
  const secondsPerSlot = 6; // EIP-8025 devnet uses 6s slots
  const maxWaitMs = waitEpochs * slotsPerEpoch * secondsPerSlot * 1000;
  const pollIntervalMs = 12000;
  const startTime = Date.now();

  let finalized = false;
  let lastData = [];

  while (Date.now() - startTime < maxWaitMs) {
    lastData = await Promise.all(
      urls.map(async (url, i) => {
        try {
          const resp = await fetchJson(
            `${url}/eth/v1/beacon/states/head/finality_checkpoints`
          );
          return resp.data;
        } catch (e) {
          return null;
        }
      })
    );

    const anyFinalized = lastData.some(
      (d) => d && Number(d.finalized.epoch) > 0
    );
    if (anyFinalized) {
      finalized = true;
      break;
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    process.stdout.write(
      `\r  Waiting for finality... ${elapsed}s / ${Math.round(maxWaitMs / 1000)}s`
    );
    await sleep(pollIntervalMs);
  }

  if (!finalized) {
    process.stdout.write("\r" + " ".repeat(60) + "\r");
  } else {
    process.stdout.write("\r" + " ".repeat(60) + "\r");
  }

  for (let i = 0; i < lastData.length; i++) {
    const d = lastData[i];
    if (!d) {
      fail(`${nodeLabel(i)} — failed to fetch finality checkpoints`);
      continue;
    }
    info(
      `${nodeLabel(i)}: finalized=${d.finalized.epoch} justified=${d.current_justified.epoch} current=${d.previous_justified.epoch}`
    );
  }

  if (finalized) {
    const finalizedEpoch = Math.max(
      ...lastData.filter(Boolean).map((d) => Number(d.finalized.epoch))
    );
    pass(`Chain is finalizing (epoch ${finalizedEpoch})`);
  } else {
    fail("Chain has not finalized after waiting");
  }
}

async function checkOptimisticStatus(url, nodeIndex) {
  section("Optimistic Status (zkEVM node)");

  try {
    const resp = await fetchJson(`${url}/eth/v1/beacon/blinded_blocks/head`);
    const optimistic = resp.execution_optimistic;
    info(`execution_optimistic: ${optimistic}`);

    if (optimistic === false) {
      pass("PROOF-DRIVEN EXECUTION WORKING — node verified via proofs, not EL");
    } else if (optimistic === true) {
      fail(
        "Node is still optimistic — proofs may not have arrived or been verified yet"
      );
    } else {
      fail(`Unexpected execution_optimistic value: ${optimistic}`);
    }
  } catch (e) {
    fail(`Failed to check optimistic status: ${e.message}`);
  }
}

async function checkProofPool(url) {
  section("Proof Pool");

  try {
    const resp = await fetchJson(`${url}/eth/v1/beacon/pool/execution_proofs`);
    const proofs = Array.isArray(resp.data) ? resp.data.length : 0;
    info(`Proofs in pool: ${proofs}`);

    if (proofs > 0) {
      pass("Proofs are being received");
    } else {
      fail("No proofs found in pool");
    }
  } catch (e) {
    fail(`Failed to check proof pool: ${e.message}`);
  }
}

async function checkPeers(urls) {
  section("Peers");

  await Promise.all(
    urls.map(async (url, i) => {
      try {
        const resp = await fetchJson(`${url}/eth/v1/node/peers`);
        const count = Array.isArray(resp.data) ? resp.data.length : 0;
        info(`${nodeLabel(i)}: ${count} peers`);
      } catch (e) {
        fail(`${nodeLabel(i)} — failed to fetch peers: ${e.message}`);
      }
    })
  );
}

async function checkSync(urls) {
  section("Sync");

  await Promise.all(
    urls.map(async (url, i) => {
      try {
        const resp = await fetchJson(`${url}/eth/v1/node/syncing`);
        const d = resp.data;
        info(
          `${nodeLabel(i)}: syncing=${d.is_syncing} sync_distance=${d.sync_distance}`
        );
      } catch (e) {
        fail(`${nodeLabel(i)} — failed to fetch sync status: ${e.message}`);
      }
    })
  );
}

// --- Entrypoint ---

async function main() {
  const args = parseArgs(process.argv);

  let urls;
  if (args.urls) {
    urls = args.urls;
  } else {
    console.log(dim("Auto-discovering beacon URLs from kurtosis..."));
    try {
      urls = await discoverUrlsFromKurtosis();
    } catch (e) {
      console.error(red(e.message));
      process.exit(1);
    }
  }

  const zkevmIndex =
    args.zkevmIndex !== null ? args.zkevmIndex : urls.length - 1;

  console.log(bold("\n=== EIP-8025 Devnet Validation ==="));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Nodes: ${urls.length}`);
  console.log(`zkEVM node: index ${zkevmIndex} (${urls[zkevmIndex]})`);

  await checkChainHealth(urls);
  await checkFinality(urls, args.waitEpochs);
  await checkOptimisticStatus(urls[zkevmIndex], zkevmIndex);
  await checkProofPool(urls[zkevmIndex]);
  await checkPeers(urls);
  await checkSync(urls);

  // Final result
  console.log("");
  if (failures.length === 0) {
    console.log(bold(green("=== RESULT: PASS ===")));
    process.exit(0);
  } else {
    console.log(bold(red(`=== RESULT: FAIL (${failures.length} issue${failures.length > 1 ? "s" : ""}) ===`)));
    for (const f of failures) {
      console.log(red(`  - ${f}`));
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(red(`Fatal error: ${e.message}`));
  process.exit(1);
});
