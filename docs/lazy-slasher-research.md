# Lazy Slasher Research

**Source**: [ethresear.ch - A lazy approach to slashers](https://ethresear.ch/t/a-lazy-approach-to-slashers/22041)
**Author**: Potuz (2025-03-28)
**Updated**: 2026-02-06

## Executive Summary

The lazy slasher proposal replaces heavy per-validator attestation tracking with lightweight aggregate functions that trigger on-demand verification only when anomalies are detected. This reduces storage from gigabytes to kilobytes while maintaining detection capability.

---

## Current Slasher Problem

### Traditional Min-Max Design (protolambda)

For each validator `v` and epoch `i`, current slashers maintain:
- `m_v(i)` = minimum target epoch where source > i
- `M_v(i)` = maximum target epoch where source < i

**Storage requirement**: `O(|V| × W)` where:
- `|V|` = number of validators (~1.4M on mainnet)
- `W` = weak subjectivity period (~4096 epochs)

This requires **several gigabytes** of storage and continuous processing.

### Detection Logic

When attestation `a = (s, t)` arrives from validator `v`:
1. If `t > m_v(s)` → `a` surrounds an existing attestation
2. If `t < M_v(s)` → `a` is surrounded by an existing attestation

---

## The Lazy Slasher Proposal

### Key Observations

1. **Slashings only matter in blocks**: Attestations not in blocks don't affect syncing nodes
2. **Mass events are dangerous**: Single validator violations have minimal impact (correlation penalty)
3. **Few blocks needed**: Only ~32 blocks required to slash all offenders in mass attack (proven in Holesky Pectra incident)

### Algorithm

**Replace per-validator functions with AGGREGATE functions:**

For ALL attestations `A` (not per validator):
```
m(i) = min{ t | (s,t) ∈ A and s > i }
M(i) = max{ t | (s,t) ∈ A and s < i }
```

**Storage**: `O(W)` = ~4096 epochs × 8 bytes × 2 = **~65 KB** (constant, regardless of validator count!)

### Detection Process

When receiving attestation `a = (s, t)`:

1. Check if `t > m(s)` 
2. If true: **some** attestation exists that might be surrounded by `a`
3. **BUT**: We don't know if same validator cast both!
4. Fetch blocks from epochs `t'` and `t'+1` (where surrounded attestation could be included)
5. Scan those blocks for matching validator indices
6. Generate slashings if found

### Trade-offs

| Aspect | Traditional Slasher | Lazy Slasher |
|--------|--------------------|--------------| 
| Storage | Gigabytes | Kilobytes |
| Detection | Immediate | On-demand (after trigger) |
| Processing | Continuous | Triggered |
| False positives | None | Possible (different validators) |
| Resource usage | Heavy | Light |

---

## Implementation Plan for Lodestar

### Phase 1: Core Data Structures

Create new `LazySlasher` class with:
```typescript
interface LazySlasherState {
  // Aggregate min-max arrays - one value per epoch
  minTargetBySource: Map<Epoch, Epoch>;  // m(i)
  maxTargetBySource: Map<Epoch, Epoch>;  // M(i)
  
  // Configuration
  historyLength: number;  // ~4096 epochs (weak subjectivity)
}
```

### Phase 2: Update Logic

On every attestation received:
```typescript
function updateAggregates(att: Attestation): void {
  const { source, target } = att.data;
  
  // Update m(i) for all i < source
  for (let i = target.epoch + 1; i < currentEpoch; i++) {
    const current = minTargetBySource.get(i);
    if (!current || target.epoch < current) {
      minTargetBySource.set(i, target.epoch);
    }
  }
  
  // Update M(i) for all i > source
  for (let i = 0; i < source.epoch; i++) {
    const current = maxTargetBySource.get(i);
    if (!current || target.epoch > current) {
      maxTargetBySource.set(i, target.epoch);
    }
  }
}
```

### Phase 3: Detection Logic

```typescript
function checkForSurrounds(att: Attestation): SurroundCandidate | null {
  const { source, target } = att.data;
  
  // Check if this attestation surrounds something
  const minTarget = minTargetBySource.get(source.epoch);
  if (minTarget && target.epoch > minTarget) {
    return {
      type: 'surrounds',
      triggerAttestation: att,
      searchEpochs: [minTarget, minTarget + 1]
    };
  }
  
  // Check if this attestation is surrounded
  const maxTarget = maxTargetBySource.get(source.epoch);
  if (maxTarget && target.epoch < maxTarget) {
    return {
      type: 'surrounded',
      triggerAttestation: att,
      searchEpochs: [target.epoch, target.epoch + 1]
    };
  }
  
  return null;
}
```

### Phase 4: On-Demand Verification

When surround candidate detected:
```typescript
async function findSlashings(candidate: SurroundCandidate): Promise<AttesterSlashing[]> {
  const slashings: AttesterSlashing[] = [];
  
  // Fetch blocks from relevant epochs
  const blocks = await fetchBlocksInEpochs(candidate.searchEpochs);
  
  // Extract all attestations from those blocks
  for (const block of blocks) {
    for (const att of block.body.attestations) {
      // Check if same validator cast both attestations
      const overlap = getIntersectingIndices(
        candidate.triggerAttestation,
        att
      );
      
      for (const validatorIndex of overlap) {
        if (isSurroundVote(candidate.triggerAttestation, att)) {
          slashings.push(createAttesterSlashing(
            candidate.triggerAttestation,
            att
          ));
        }
      }
    }
  }
  
  return slashings;
}
```

### Phase 5: Integration

1. Add CLI flag `--slasher.mode=lazy|off` (default: off)
2. Hook into attestation gossip handler
3. Hook into block import (for attestations in blocks)
4. Add API endpoint for manual slashing queries
5. Broadcast discovered slashings to network

---

## Files to Create/Modify

### New Files
- `packages/beacon-node/src/chain/slasher/lazySlasher.ts` - Core implementation
- `packages/beacon-node/src/chain/slasher/types.ts` - Type definitions
- `packages/beacon-node/src/chain/slasher/index.ts` - Exports

### Modified Files
- `packages/beacon-node/src/chain/chain.ts` - Initialize slasher
- `packages/beacon-node/src/chain/options.ts` - Add slasher config
- `packages/beacon-node/src/network/processor/gossipHandlers.ts` - Feed attestations
- `packages/beacon-node/src/chain/blocks/importBlock.ts` - Process block attestations

---

## References

1. [protolambda/eth2-surround](https://github.com/protolambda/eth2-surround#min-max-surround) - Original min-max design
2. [Lighthouse min-max slasher](https://hackmd.io/@sproul/min-max-slasher) - Lighthouse adaptation
3. [Prysm slasher design](https://hackmd.io/@prysmaticlabs/slasher) - Prysm implementation
4. [ethresear.ch post](https://ethresear.ch/t/a-lazy-approach-to-slashers/22041) - Original proposal

---

## Open Questions

1. How to handle epoch pruning efficiently?
2. Should we persist aggregate state to DB or rebuild from blocks?
3. API design for manual slashing queries?
4. How to test on devnet without real slashable events?
5. Integration with existing OpPool for broadcasting slashings?
