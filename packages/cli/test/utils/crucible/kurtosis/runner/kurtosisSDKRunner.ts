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
   * Creates a new KurtosisSDKRunner instance.
   *
   * enclaveName: Default name for the Kurtosis enclave - can be overridden
   */
  constructor(enclaveName = "crucible-enclave") {
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

    for (const [serviceName] of servicesResult.value) {
      const ctxResult = await this.enclaveContext.getServiceContext(serviceName);
      if (ctxResult.isErr()) throw ctxResult.error;

      const serviceContext = ctxResult.value;
      const ports = serviceContext.getPublicPorts();

      const node: NodeService = {
        // FIXME: check if fields are correct
        id: serviceName,
        serviceContext,
        beaconApiUrl: ports.get("http") ? `http://localhost:${ports.get("http")?.number}` : undefined,
        roles: this.inferRoles(serviceName),
        metadata: {},
      };

      services.set(serviceName, node);
    }

    return services;
  }

  on(_event: RunnerEvent, _cb: (id: string) => void | Promise<void>): void {
    // TODO: Event handling not implemented yet
  }

  // Helper function as services come back as generic ServiceContext object -> it derives the logical role
  private inferRoles(serviceName: string): NodeService["roles"] {
    return {
      // FIXME: check if inferRoles is necessary
      beacon: serviceName.includes("cl"), //|| serviceName.includes("beacon")
      validator: serviceName.includes("vc"), //|| serviceName.includes("validator")
      execution: serviceName.includes("el"), //|| serviceName.includes("execution")
    };
  }
}
