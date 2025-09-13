/**
 * Kurtosis Runner Test Suite
 * ==========================
 *
 * This file provides a comprehensive testing and demonstration framework for the
 * Kurtosis SDK integration with Ethereum network simulation. It serves as both
 * a functional test suite and a reference implementation for understanding
 * how to interact with Kurtosis-managed Ethereum services.
 *
 * Purpose:
 * --------
 * - Test the KurtosisSDKRunner implementation
 * - Demonstrate service creation and management
 * - Provide comprehensive logging of all service parameters
 * - Validate network configuration and service discovery
 * - Serve as a debugging tool for Kurtosis network issues
 *
 * Architecture:
 * ------------
 * The test follows this lifecycle:
 * 1. Load Kurtosis network configuration from YAML
 * 2. Initialize Kurtosis enclave environment
 * 3. Create and deploy Ethereum network services
 * 4. Log service information and network summary
 * 5. Clean up resources and stop the enclave
 *
 * Service Types Supported:
 * -----------------------
 * - Consensus Layer (CL): Beacon nodes (Lodestar, Lighthouse, etc.)
 * - Execution Layer (EL): Execution clients (Geth, Nethermind, etc.)
 * - Validator Clients (VC)
 * - Additional Services: dora, assertoor, etc.
 *
 * Configuration:
 * -------------
 * The test loads configuration from YAML files
 *
 * Usage:
 * ------
 * Docker running
 * Kurtosis engine running:
 *   kurtosis engine start
 * Run the test using:
 *   npx tsx runner-test.ts
 *
 * Output:
 * -------
 * - Service creation status and lifecycle
 * - Container configuration
 * - Private/Public port mappings and network endpoints
 * - Service roles and responsibilities
 * - Network topology and service relationships
 *
 * Error Handling:
 * --------------
 * - Graceful degradation for missing services
 * - Comprehensive error reporting with context
 * - Resource cleanup on failure
 */

import path from "node:path";
import {fileURLToPath} from "node:url";
import {KurtosisSDKRunner} from "../runner/kurtosisSDKRunner.js";
import {loadKurtosisConfig} from "../runner/loadKurtosisConfig.js";

async function main() {
  // Get the current file path
  const __filename = fileURLToPath(import.meta.url);
  // Get the directory name
  const __dirname = path.dirname(__filename);

  const enclaveName = "adhoc-runner-test";

  //const configPath = path.resolve(__dirname, "multi-fork.yml");
  const configPath = path.resolve(__dirname, "network-basic.yml");

  console.log("🔹 Loading Kurtosis config from:", configPath);
  const kurtosisConfig = await loadKurtosisConfig(configPath);

  const runner = new KurtosisSDKRunner();

  console.log("🔹 Starting enclave:", enclaveName);
  await runner.start(enclaveName);

  console.log("🔹 Creating services...");
  const services = await runner.create(kurtosisConfig);

  console.log("✅ Services created:");
  for (const [id, svc] of services) {
    console.log(`\nService: ${id}`);

    // Log all NodeService parameters
    console.log("  🔹 Basic Properties:");
    console.log(`    ID: ${svc.id}`);
    console.log(`    API URL: ${svc.apiUrl || "undefined"}`);
    console.log(`    Role: ${svc.role}`);
    console.log(`    Metadata: ${JSON.stringify(svc.metadata || {})}`);

    // Log ServiceContext properties and methods
    console.log("  🔹 ServiceContext Details:");

    // Parse and format container information
    const containerInfo = svc.serviceContext.getContainer();
    if (containerInfo) {
      console.log("    Container Details:");

      // Check if it's a Container object (from Kurtosis SDK)
      if (typeof containerInfo === "object" && containerInfo.getImageName) {
        // FIXME: check logic of logs
        // It's a proper Container object
        console.log(`      Image: ${containerInfo.getImageName()}`);
        console.log(`      Status: ${containerInfo.getStatus()}`); // 0 = STOPPED, 1 = RUNNING, 2 = UNKNOWN

        // Entrypoint Arguments
        const entrypointArgs = containerInfo.getEntrypointArgsList();
        if (entrypointArgs && entrypointArgs.length > 0) {
          console.log(`      Entrypoint: ${entrypointArgs.join(" ")}`);
        }

        // Command Arguments
        const cmdArgs = containerInfo.getCmdArgsList();
        if (cmdArgs && cmdArgs.length > 0) {
          console.log(`      Command: ${cmdArgs.join(" ")}`);
        }

        // Environment Variables
        try {
          const envVarsArray = containerInfo.toObject().envVarsMap;
          if (envVarsArray && envVarsArray.length > 0) {
            console.log("      Environment Variables:");
            for (const [key, value] of envVarsArray) {
              console.log(`        ${key}=${value}`);
            }
          }
        } catch (_e) {
          console.log("      Environment Variables: Unable to read");
        }

        // Parse command line arguments for network analysis
        const allArgs = [...(entrypointArgs || []), ...(cmdArgs || [])];

        if (allArgs.length > 0) {
          console.log("      Arguments:");

          // Group related arguments
          const groupedArgs: Record<string, string[]> = {
            Network: [],
            "HTTP/API": [],
            Data: [],
            Discovery: [],
            Metrics: [],
            Execution: [],
            Other: [],
          };

          for (const arg of allArgs) {
            if (arg.startsWith("--port=") || arg.startsWith("--listen-address=") || arg.startsWith("--enr-")) {
              groupedArgs["Network"].push(arg);
            } else if (arg.startsWith("--http") || arg.startsWith("--api")) {
              groupedArgs["HTTP/API"].push(arg);
            } else if (arg.startsWith("--datadir=") || arg.startsWith("--testnet-dir=")) {
              groupedArgs["Data"].push(arg);
            } else if (arg.startsWith("--boot-nodes=") || arg.startsWith("--enable-private-discovery")) {
              groupedArgs["Discovery"].push(arg);
            } else if (arg.startsWith("--metrics")) {
              groupedArgs["Metrics"].push(arg);
            } else if (arg.startsWith("--execution-endpoints=") || arg.startsWith("--jwt-secrets=")) {
              groupedArgs["Execution"].push(arg);
            } else if (arg.startsWith("--")) {
              groupedArgs["Other"].push(arg);
            }
          }

          // Display grouped arguments
          for (const [category, categoryArgs] of Object.entries(groupedArgs)) {
            if (categoryArgs.length > 0) {
              console.log(`        ${category}:`);
              for (const arg of categoryArgs) {
                console.log(`          ${arg}`);
              }
            }
          }
        }
        // FIXME: check logic of logs
      } else if (typeof containerInfo === "string") {
        // It's a string (comma-separated format)
        const parts = (containerInfo as string).split(",");
        console.log(`      Image: ${parts[0]}`);
        console.log(`      Tag: ${parts[1] || "latest"}`);
        console.log(`      Name: ${parts[2] || "unnamed"}`);
        console.log(`      Command: ${parts[3] || "none"}`);

        // Parse command line arguments
        if (parts.length > 4) {
          const args = parts.slice(4);
          console.log(`      Arguments: ${args.join(" ")}`);
        }
      } else {
        // Unknown format
        console.log(`      Container: ${JSON.stringify(containerInfo)}`);
      }
    } else {
      console.log("      Container: Not available");
    }

    console.log(
      `    Public Ports: ${Array.from(svc.serviceContext.getPublicPorts().entries())
        .map(([k, v]) => `${k}:${v.number}`)
        .join(", ")}`
    );
    console.log(
      `    Private Ports: ${Array.from(svc.serviceContext.getPrivatePorts().entries())
        .map(([k, v]) => `${k}:${v.number}`)
        .join(", ")}`
    );
  }

  // NETWORK SUMMARY
  console.log("\n🔹 NETWORK SUMMARY:");
  console.log(`   Total Services: ${services.size}`);

  const serviceTypes = {
    "Consensus Layer": 0,
    "Execution Layer": 0,
    "Validator Client": 0,
    Other: 0,
  };

  for (const [id] of services) {
    if (id.startsWith("cl-")) serviceTypes["Consensus Layer"]++;
    else if (id.startsWith("el-")) serviceTypes["Execution Layer"]++;
    else if (id.startsWith("vc-")) serviceTypes["Validator Client"]++;
    else serviceTypes["Other"]++;
  }

  for (const [type, count] of Object.entries(serviceTypes)) {
    if (count > 0) {
      console.log(`   ${type}: ${count}`);
    }
  }

  /**
   * Cleanup and Resource Management
   * ===============================
   *
   * 1. Stop all services before destroying the enclave
   * 2. Remove the Kurtosis enclave and free system resources
   *
   */

  console.log("🛑 Stopping enclave...");
  await runner.stop();
}

main().catch((err) => {
  console.error("❌ Runner adhoc test failed:", err);
  process.exit(1);
});
