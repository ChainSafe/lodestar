/**
 * KurtosisSDKRunner - Ethereum Network Simulation Runner
 * =====================================================
 *
 * An implementation of the KurtosisSDKRunner that leverages
 * Kurtosis SDK for creating and managing Ethereum network simulations.
 * It acts as a replacement for the current Runner.
 *
 * This runner provides:
 * - Enclave lifecycle management (create, start, stop, destroy)
 * - Service deployment using ethpandaops/ethereum-package
 * - Automatic service role inference and metadata extraction
 * - Resource cleanup and error handling
 *
 */

import {EnclaveContext, KurtosisContext, StarlarkRunConfig} from "kurtosis-sdk";
import {IRunner, RunnerEvent} from "../simulation/interfaces-kurtosis.js";
import {KurtosisNetworkConfig, KurtosisServicesMap, NodeService} from "./kurtosisTypes.js";

export class KurtosisSDKRunner implements IRunner {
  private enclaveName: string;
  private kurtosisContext?: KurtosisContext;
  private enclaveContext?: EnclaveContext;

  /**
   * Creates a new KurtosisSDKRunner instance
   *
   * @param enclaveName - Unique name for the Kurtosis enclave (required for isolation)
   */
  constructor(enclaveName: string) {
    this.enclaveName = enclaveName;
  }

  // This method establishes a connection to the local Kurtosis engine
  // and creates an isolated environment for the Ethereum network simulation
  async start(enclaveName: string): Promise<void> {
    // Create engine context
    const contextResult = await KurtosisContext.newKurtosisContextFromLocalEngine();
    if (contextResult.isErr()) throw contextResult.error;
    this.kurtosisContext = contextResult.value;

    // Keep enclave identity in state
    this.enclaveName = enclaveName;

    // Create enclave and store its context
    const enclaveResult = await this.kurtosisContext.createEnclave(this.enclaveName);
    if (enclaveResult.isErr()) throw enclaveResult.error;
    this.enclaveContext = enclaveResult.value;
  }

  async stop(): Promise<void> {
    if (this.kurtosisContext && this.enclaveName) {
      await this.kurtosisContext.destroyEnclave(this.enclaveName);
    }
  }

  private inferRole(serviceName: string, ports: Map<string, {number?: number}>): NodeService["role"] {
    // Primary: prefix-based
    if (/^cl-\d+/.test(serviceName)) return "beacon";
    if (/^el-\d+/.test(serviceName)) return "execution";
    if (/^vc-\d+/.test(serviceName)) return "validator";
  
    // Fallback: port signatures
    const portKeys = [...ports.keys()];
    const hasEngine = portKeys.some(k => k.includes("engine"));
    const hasHttpValidator = portKeys.some(k => k === "http-validator" || k.includes("validator"));
    if (hasEngine) return "execution";
    if (hasHttpValidator) return "validator";
    // If it has discovery ports 9000 TCP/UDP + generic http, treat as beacon
    if (portKeys.includes("http") && (portKeys.includes("tcp-discovery") || portKeys.includes("udp-discovery"))) {
      return "beacon";
    }
  
    throw new Error(`Unable to infer role for service: ${serviceName}`);
  }
  
  // Derive nodeIndex: Extract the numeric node index used by the package (e.g., cl-1-... → 1)
  private extractIndexFromName(serviceName: string): number | undefined {
    // Matches cl-1-..., el-2-..., vc-3-...
    const m = serviceName.match(/^(cl|el|vc)-(\d+)\b/i);
    return m ? Number(m[2]) : undefined;
  }
  

  /**
   * Creates and deploys the Ethereum network based on the provided configuration
   *
   * This method orchestrates the deployment of the entire Ethereum network
   * using the ethpandaops/ethereum-package Starlark package. It creates
   * consensus layer, execution layer, and validator services according to
   * the configuration specification.
   *
   * config: Network configuration specifying participants and parameters
   * Output: Promise resolving to a map of service names to NodeService objects
   *
   */

  async create(config: KurtosisNetworkConfig): Promise<KurtosisServicesMap> {
    if (!this.enclaveContext) {
      throw new Error("Enclave context not initialized. Did you call start()?");
    }

    const serializedParams = JSON.stringify(config);
    const runConfig = new StarlarkRunConfig(
      StarlarkRunConfig.WithSerializedParams(serializedParams),
      StarlarkRunConfig.WithDryRun(false)
    );

    const pkg = "github.com/ethpandaops/ethereum-package";
    const runResult = await this.enclaveContext.runStarlarkRemotePackageBlocking(pkg, runConfig);
    if (runResult.isErr()) throw runResult.error;

    const run = runResult.value;
    if (run.executionError) {
      throw new Error(`Package executionError: ${run.executionError}`);
    }

    const servicesResult = await this.enclaveContext.getServices();
    if (servicesResult.isErr()) throw servicesResult.error;

    const services: KurtosisServicesMap = new Map(); //Mapping Kurtosis services

    /*for (const [serviceName] of servicesResult.value) {
      const ctxResult = await this.enclaveContext.getServiceContext(serviceName);
      if (ctxResult.isErr()) throw ctxResult.error;

      const serviceContext = ctxResult.value;
      const ports = serviceContext.getPublicPorts();

      const node: NodeService = {
        // FIXME: check if fields are correct
        id: serviceName,
        serviceContext,
        apiUrl: ports.get("http") ? `http://localhost:${ports.get("http")?.number}` : undefined,
        role: this.inferRole(serviceName),
        metadata: {},
      };

      services.set(serviceName, node);
    }

    return services;*/
    for (const [serviceName] of servicesResult.value) {
      // Filter out utility services that don't have expected prefixes (cl-, el-, vc-)
      if (!/^(cl|el|vc)-\d+/.test(serviceName)) {
        console.log(`Skipping utility service: ${serviceName}`);
        continue;
      }
  /**
         if (!/^(cl|el|vc)-\d+/.test(serviceName) && 
          !/beacon|execution|validator/.test(serviceName)) {
        console.log(`Skipping utility service: ${serviceName}`);
        continue;
      }
       */
      const ctxRes = await this.enclaveContext.getServiceContext(serviceName);
      if (ctxRes.isErr()) throw ctxRes.error;
      const serviceContext = ctxRes.value;
      const ports = serviceContext.getPublicPorts();
      const role = this.inferRole(serviceName, ports);
      const nodeIndex = this.extractIndexFromName(serviceName);

      if (nodeIndex === undefined) {
        throw new Error(`Unable to infer node index from service: ${serviceName}` 
        + `Expected format like: cl-1, el-2, vc-3`
        );
      }
  
      const node: NodeService = {
        id: serviceName,
        serviceContext,
        role,
        // “http” is optional; many we construct later via port lookup
        apiUrl: ports.get("http") ? `http://localhost:${ports.get("http")!.number}` : undefined,
        metadata: { nodeIndex },
      };
  
      services.set(serviceName, node);
    }
  
    // DEBUG (keep briefly): show what we discovered
    // for (const n of services.values()) {
    //   console.log(`DISCOVERED ${n.id} role=${n.role} nodeIndex=${n.metadata?.nodeIndex}`);
    // }
  
    return services;
  }

  // Placeholder to wire runner-level events (start/stop/crash). Not used yet but reserved for future needs
  on(_event: RunnerEvent, _cb: (id: string) => void | Promise<void>): void {
    // TODO: Event handling not implemented yet
  }

  /*
  // Helper function as services come back as generic ServiceContext object -> it derives the logical role
  private inferRole(serviceName: string): NodeService["role"] {
    if (serviceName.includes("cl")) return "beacon";
    if (serviceName.includes("vc")) return "validator";
    if (serviceName.includes("el")) return "execution";

    // Default fallback - could be improved with better service naming detection
    throw new Error(`Unable to infer role for service: ${serviceName}`);
  }
  */

  
}
