# Monitoring Attestations: Complete Guide for Lodestar Validators


## Introduction to Attestations

Validators are participants in Ethereum's consensus mechanism which is Proof of Stake, they are expected to create, sign, and broadcast an attestation during each epoch, and this enhances the security of the blockchain, to be a validator you stake 32 ETH as collateral. This ensures they have economic incentive to attest to the correct blocks for the chain.

Every validator has two primary responsibilities on the beacon chain:
1. **Proposing blocks** 
2. **Creating attestations** 

The beacon chain happens to be an extension of the main chain which stores and manage the registry of validators. 

**What are attestations?** Think of attestations as votes on the validity of blocks, and these votes get aggregated into the Beacon Chain to ensure the network reaches consensus on the correct state.

### Why Attestations Matter for Your Rewards

Attestations make up the majority of a validator's rewards, and if an attestation is late or missed, it affects the validator's rewards and the security of the entire network is weakened.

A validator should create, sign, and broadcast an attestation to the associated subnet when either:
- (a) You receive a valid block from the expected proposer for your assigned slot, or
- (b) 1/3 of the slot time has passed (4 seconds after slot start), whichever comes first

## Understanding the Attestation Workflow



![Attestation Workflow Diagram](../validator-management/images/attestation_stage.png)

Every successful attestation follows these five critical stages:

### Stage 1: Vote Creation & Signing (0-1 seconds)
The validator examines the current chain state and creates attestation data containing:
- **Head block**: The block they believe is the current head
- **Source checkpoint**: The most recent justified block  
- **Target checkpoint**: The first block of the current epoch

The validator signs this data with their private key. Note that, the committee index isn't included in the signed root, and this is because it allows identical votes to look the same across different committees.

### Stage 2: P2P Network Propagation (1-2 seconds)
Your signed attestation gets broadcast through Ethereum's gossip subnet system. The network has built-in protection - if someone tampers with the committee index, the gossip rules automatically reject it.

### Stage 3: Committee Aggregation (2-3 seconds)  
This is where the magic of efficiency happens. Aggregators collect and bundle identical votes together. Thanks to **EIP-7549** (post-Electra upgrade), identical votes from different committees can now be aggregated together efficiently.

**Why this matters:** Instead of checking 1,366 individual signatures, the system only needs to verify 22 aggregate signatures - a massive efficiency gain that benefits the entire network.

### Stage 4: Broadcast to Block Proposers (3-4 seconds)
The aggregated attestations get sent to block proposers as compact bitfields. This space-efficient format means blocks can carry more attestations per slot, directly boosting chain security and finality.

### Stage 5: Block Inclusion (Next slot)
Finally, block proposers include your aggregated attestations in their beacon blocks. More votes fitting into each block strengthens the network's consensus and finality guarantees.

## Critical Timing Requirements

![Beacon Chain Timeline](../validator-management/images/beacon-chain.png)

**The 4-Second Rule:** In every 12-second slot, timing is everything. Here's how the time gets allocated:

- **0-4 seconds**: Validator attestation window
- **4-8 seconds**: Aggregation happens  
- **8-12 seconds**: Block proposer preparation for next slot

Missing that first 4-second window dramatically reduces your chances of aggregation, which directly lowers your rewards.

### Timeline Breakdown
```
Slot start (0s) → Attestation duty (0-4s) → Aggregation (4-8s) → Next slot prep (8-12s)
```

## Each Flags Explained

Ethereum measures validator performance using timing-based participation flags. Each flag determines how much of your total rewards you'll get:

| Flag | Timing Requirement | Reward % | Reason |
|------|-------------------|----------|---------|
| **Timely Head** | ≤ 1 slot (12s) | 100% | Confirms latest block as head |
| **Timely Target** | ≤ 32 slots (~6.4 min) | ~75% | Confirms finality checkpoints |
| **Timely Source** | ≤ 6 slots (~1.2 min) | ~25% | Confirms justified checkpoints |
| **Missed/Late** | Too late or not included | 0% + penalties | No rewards, weakens security |

### What The Flags Mean

**Timely Head** - Perfect performance! Your attestation was included in the very next slot, meaning you voted on the correct head block and submitted on time.

**Timely Target** - Good performance, but not perfect. Your attestation was included within the same epoch, confirming important finality checkpoints for Casper FFG.

**Timely Source** - Minimal performance. Your attestation was quite delayed but still made it within 6 slots, at least confirming some older justified checkpoints.

**Missed** - You really want to avoid this. This happens if your attestation either arrived too late or wasn't included at all, leading to zero rewards and potential penalties.

## Lodestar Attestation Status Reference

The Lodestar `attestation_summary` metric provides detailed diagnostic labels to help you understand exactly what happened with each attestation attempt.

### Maximum Success
| Label | Meaning | Action Needed |
|-------|---------|---------------|
| `timely_head` | Perfect performance - all timing requirements met | None - celebrate this! |

### Partial Success - Target Met
| Label | Explanation | Possible Reasons |
|-------|-------------|--------------|
| `timely_target_next_slot_missed` | Would have been perfect, but next slot was skipped by network | Not your fault - network issue |
| `timely_target_wrong_head_vote` | Included on time but voted for wrong head block | You set the head block too late |
| `timely_target_no_aggregate_inclusion` | Never seen in any aggregate, causing delay | Network propagation or aggregator problems |
| `timely_target_late_unknown` | Inclusion distance > 1, but reason unclear | Check your logs for patterns |

### Partial Success - Combined Issues  
| Label | Description |
|-------|-------------|
| `timely_target_wrong_head_vote_late_unknown` | Wrong head vote plus unknown delay causes |
| `timely_target_wrong_head_vote_next_slot_missed` | Wrong head vote plus next slot was missed |
| `timely_target_wrong_head_vote_no_aggregate_inclusion` | Wrong head vote plus no aggregation seen |

### Critical Failures
| Label | Description | Severity |
|-------|-------------|-----------|
| `no_submission` | Your validator never submitted an attestation | **CRITICAL** - Check validator client immediately |
| `no_aggregate_inclusion` | You submitted but it was never seen in aggregates | **HIGH** - Network/aggregation issues |
| `aggregate_inclusion_but_missed` | Seen in aggregates but not included in any blocks | **MEDIUM** - Block proposer issues |

### Advanced Diagnostic Labels
| Label | Description | Investigation Focus |
|-------|-------------|-------------------|
| `unexpected_timely_target_without_summary` | Attestation appeared on-chain despite not being submitted to your beacon node | Check for multiple beacon node conflicts |
| `wrong_target_timely_source` | Correct source but wrong target (happens on first slot of epoch) | Check your head block import timing |
| `unexpected_*` | Bad beacon node states preventing proper diagnosis | Check overall beacon node health |

## Debugging Unsatisfactory Attestation Performance

If it happens that your attestation performance isn't meeting the requirements, follow this systematic approach to know the issue:

### Step 1: Identify The Patterns in Your Performance
Start by checking your recent attestation summary logs:

```bash
grep "attestation_summary" /path/to/lodestar/logs | tail -100
```

Look for repeatitive patterns - are you getting the same type of failures always? This helps identify the source of the issue.

### Step 2: Verify Network Connectivity  
Ensure your node is keeping healthy peer connections:

```bash
# Check peer connections
grep "peer.*connect" /path/to/lodestar/logs | tail -20

# Verify subnet subscriptions
grep "subnet.*subscription" /path/to/lodestar/logs | tail -10
```

If there are insufficient peers on your required subnets this will cause attestation publishing failures.

### Step 3: Analyze Block Timing Issues
Late blocks are a common cause of attestation problems:

```bash
# Find blocks that arrived late
grep "block.*late" /path/to/lodestar/logs | tail -20

# Check for execution layer delays
grep "execution.*delay" /path/to/lodestar/logs | tail -10
```

If blocks usually arrive after the 4-second mark, you'll find it difficult to make timely head votes.

### Step 4: System Health Check
Ensure your system isn't the cause any issue also:

```bash
# Check time synchronization (crucial for validators)
timedatectl status

# Monitor resource usage
top -p $(pgrep lodestar)

# Check disk I/O performance  
iostat -x 1 5
```

When your system performs poorly, it also affects your ability to process blocks quickly enough for timely attestations.

### Step 5: Compare with Network Data
Cross-reference your performance with external data:
- Check your validator on **beaconcha.in** for inclusion rates
- Compare your effectiveness percentage with network averages
- Look for patterns that might indicate ISP or geographical issues

## Better Ways to Improve Perfomance

### Having a Maintenance Schedule
- **Daily**: Watch out for the validator client logs for warnings or errors
- **Weekly**: Keep clients updated to latest stable versions  
- **Monthly**: Check hardware performance metrics and optimize as needed
- **Ongoing**: Verify network connectivity and maintain healthy peer counts

### Hardware Considerations
- **CPU**: Ensure sufficient processing power for timely block imports
- **RAM**: Adequate memory for chain state management
- **Storage**: Fast SSD storage for rapid data access
- **Network**: Stable, low-latency internet connection

### Network Optimization
- Configure proper firewall settings for P2P connections
- Consider multiple execution client connections for redundancy
- Monitor and maintain diverse peer connections across all subnets

## Conclusion

Effective attestation monitoring is important to get your full validator rewards while contributing to Ethereum's security. With this guide, you'll be able to identify and resolve issues before they significantly affect your rewards.

Remember that attestations represent the majority of your validator rewards - investing time in optimizing this process pays dividends in both profitability and network contribution. Use the debugging tools and systematic approach outlined in this guide to maintain peak performance.

The key to success is consistent monitoring, prompt issue resolution, and staying updated with the latest client improvements and network changes.