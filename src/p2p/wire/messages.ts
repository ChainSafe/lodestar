
export interface Request {
  id: number;
  method_id: number;
  body: string;
}

export interface Response {
  id: number;
  response_code: number;
  result: Buffer;
}

// Method ID: 0

export interface Hello {
  network_id: number;
  chain_id: number;
  latest_finalized_root: Buffer;
  latest_finalized_epoch: number;
  best_root: Buffer;
  best_slot: number;
}

// Method ID: 1

export interface Goodbye {
  reason: number;
}

// Method ID: 2

export interface GetStatus {
  sha: Buffer;
  user_agent: Buffer;
  timestamp: number;
} 

// Method ID: 10

export interface RequestBeaconBlockRoots {
  start_slot: number;
  count: number;
}

export interface BeaconBlockRoots {
  block_root: Buffer;
  slot: number;
  // Doesn't currently exist as a standalone type
  roots: []BlockRootSlot;
}

// Method ID: 11
export interface RequestBeaconBlockHeader {
  // Doesn't currently exist as a standalone type	
  start_root: HashTreeRoot; 
  start_slot: number;
  max_headers: number;
  skip_slots: number;
}

export interface BeaconBlockHeaders {
  // Doesn't currently exist as a standalone type
  headers: []BeaconBlockHeader
}

// Method ID: 12
export interface RequestBeaconBlockBodies {
  block_roots: []HashTreeRoot;
}

export interface BeaconBlockBodies {
  block_bodies: []BeaconBlockBody;
}

// Method ID: 13
export interface RequestBeaconChainState {
  hashes: []HashTreeRoot;
}
