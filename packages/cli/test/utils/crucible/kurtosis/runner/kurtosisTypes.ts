/*
* KurtosisServiceMap returning a NodeService for more detailed metadata
*
* Enriched: {
    "lodestar_1": {
      serviceContext: ServiceContext,
      beaconApiUrl: "http://localhost:PORT"
    },
    ...
  }
*/

import {ServiceContext} from "kurtosis-sdk";

// Core simulation config passed to Kurtosis runner
// Replicating network config from .YAML file
export type KurtosisNetworkConfig = {
  participants: Array<{
    el_type: string;
    cl_type: string;
    cl_image?: string;
    count?: number;
    cl_extra_params?: string[];
    el_extra_params?: string[];
  }>;
  additional_services?: string[];
  network_params: Record<string, string | number>;
};

// Optional enrichment for nodes
// FIXME: check if boolean is the best way to represent roles
// Proposed solution: Return a BeaconClient type (i.e. "BeaconClient.Lodestar")
export type NodeRoles = {
  beacon?: boolean;
  validator?: boolean;
  execution?: boolean;
};

// Service abstraction, intended to be adjusted with the correct metadata
// FIXME: verify which NodeService parameters are actually required vs optional
export type NodeService = {
  id: string;
  serviceContext: ServiceContext;
  beaconApiUrl?: string;
  roles?: NodeRoles; // TODO: check if required or optional
  metadata?: Record<string, string | number>;
};

// Map of all services (used by test runner and tracker)
export type KurtosisServicesMap = Map<string, NodeService>;
