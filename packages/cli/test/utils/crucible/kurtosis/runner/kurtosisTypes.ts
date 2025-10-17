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
    vc_extra_params?: string[];
  }>;
  additional_services?: string[];
  network_params: Record<string, string | number>;
};

// Kurtosis services have only one role - mutually exclusive
export type NodeRole = "beacon" | "validator" | "execution";

// Service abstraction, intended to be adjusted with the correct metadata
export type NodeService = {
  id: string;
  serviceContext: ServiceContext;
  apiUrl?: string; // Generic API URL for beacon, execution, or validator
  role: NodeRole; // Required - each service has exactly one role
  metadata?: Record<string, string | number>;
};

// Map of all services (used by test runner and tracker)
export type KurtosisServicesMap = Map<string, NodeService>;
