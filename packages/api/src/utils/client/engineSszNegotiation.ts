import {
  type EngineSszEndpoint,
  getMutuallySupportedEngineSszCapabilities,
  isEngineSszEndpointSupported,
} from "./engineSszCapabilities.js";
import {
  type EngineSszMethodDescriptor,
  getEngineSszCapabilityForMethod,
  getUniqueEngineSszCapabilitiesFromElCapabilities,
} from "./engineSszMethodMap.js";

/**
 * Tracks negotiated Engine API SSZ endpoint support based on
 * engine_exchangeCapabilities response.
 */
export class EngineSszNegotiationState {
  private supported = new Set<EngineSszEndpoint>();

  constructor(private readonly clCapabilities: string[]) {}

  /** Update negotiated support from EL-advertised capabilities list. */
  updateFromElCapabilities(elCapabilities: string[]): void {
    const mappedFromMethods = getUniqueEngineSszCapabilitiesFromElCapabilities(elCapabilities);
    this.supported = getMutuallySupportedEngineSszCapabilities(this.clCapabilities, [
      ...elCapabilities,
      ...mappedFromMethods,
    ]);
  }

  /** Returns true if this method is currently negotiated for SSZ transport. */
  isMethodSupported(method: string): boolean {
    const capability = getEngineSszCapabilityForMethod(method);
    if (capability === null) return false;
    return isEngineSszEndpointSupported(this.supported, capability);
  }

  /**
   * Returns true if descriptor capability is negotiated for SSZ transport.
   * Useful after method+params mapping has resolved concrete path.
   */
  isDescriptorSupported(descriptor: EngineSszMethodDescriptor): boolean {
    return isEngineSszEndpointSupported(this.supported, descriptor.capability);
  }

  getSupportedCapabilities(): EngineSszEndpoint[] {
    return [...this.supported];
  }
}
