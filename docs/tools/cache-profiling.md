# Cache Profiling

## Commands

Basics:

```sh
sudo perf stat \
-p $(pgrep -f '/usr/src/lodestar/packages/cli/bin/lodestar beacon') \
-e branch-instructions,branch-misses,cache-misses,cache-references \
sleep 10
```

Recommended:

```sh
sudo perf stat \
-p $(pgrep -f '/usr/src/lodestar/packages/cli/bin/lodestar beacon') \
-e all_dc_accesses,all_tlbs_flushed,l1_dtlb_misses,l2_cache_accesses_from_dc_misses,l2_cache_accesses_from_ic_misses,l2_cache_hits_from_dc_misses,l2_cache_hits_from_ic_misses,l2_cache_hits_from_l2_hwpf,l2_cache_misses_from_dc_misses,l2_cache_misses_from_ic_miss,l2_dtlb_misses,l2_itlb_misses,sse_avx_stalls,uops_dispatched,uops_retired \
sleep 10
```

Basic & Recommended:

```sh
sudo perf stat \
-p $(pgrep -f '/usr/src/lodestar/packages/cli/bin/lodestar beacon') \
-e branch-instructions,branch-misses,cache-misses,cache-references,all_dc_accesses,all_tlbs_flushed,l1_dtlb_misses,l2_cache_accesses_from_dc_misses,l2_cache_accesses_from_ic_misses,l2_cache_hits_from_dc_misses,l2_cache_hits_from_ic_misses,l2_cache_hits_from_l2_hwpf,l2_cache_misses_from_dc_misses,l2_cache_misses_from_ic_miss,l2_dtlb_misses,l2_itlb_misses,sse_avx_stalls,uops_dispatched,uops_retired \
sleep 10
```

All sub–events:

```sh
sudo perf stat \
-p $(pgrep -f '/usr/src/lodestar/packages/cli/bin/lodestar beacon') \
-e l2_cache_accesses_from_dc_misses,l2_cache_accesses_from_ic_misses,l2_cache_hits_from_dc_misses,l2_cache_hits_from_ic_misses,l2_cache_hits_from_l2_hwpf,l2_cache_misses_from_dc_misses,l2_cache_misses_from_ic_miss,l2_dtlb_misses,l2_itlb_misses,l2_cache_req_stat.ic_access_in_l2,l2_cache_req_stat.ic_dc_hit_in_l2,l2_cache_req_stat.ic_dc_miss_in_l2,l2_cache_req_stat.ic_fill_hit_s,l2_cache_req_stat.ic_fill_hit_x,l2_cache_req_stat.ic_fill_miss,l2_cache_req_stat.ls_rd_blk_c,l2_cache_req_stat.ls_rd_blk_cs,l2_cache_req_stat.ls_rd_blk_l_hit_s,l2_cache_req_stat.ls_rd_blk_l_hit_x,l2_cache_req_stat.ls_rd_blk_x,l2_fill_pending.l2_fill_busy,l2_latency.l2_cycles_waiting_on_fills,l2_pf_hit_l2,l2_pf_miss_l2_hit_l3,l2_pf_miss_l2_l3,l2_request_g1.all_no_prefetch,l2_request_g1.cacheable_ic_read,l2_request_g1.change_to_x,l2_request_g1.group2,l2_request_g1.l2_hw_pf,l2_request_g1.ls_rd_blk_c_s,l2_request_g1.prefetch_l2_cmd,l2_request_g1.rd_blk_l,l2_request_g1.rd_blk_x,l2_request_g2.bus_locks_originator,l2_request_g2.bus_locks_responses,l2_request_g2.group1 \
sleep 10
```

Everything:

Basics:

```sh
sudo perf stat \
-p $(pgrep -f '/usr/src/lodestar/packages/cli/bin/lodestar beacon') \
-e branch-instructions,branch-misses,cache-misses,cache-references,all_dc_accesses,all_tlbs_flushed,l1_dtlb_misses,l2_cache_accesses_from_dc_misses,l2_cache_accesses_from_ic_misses,l2_cache_hits_from_dc_misses,l2_cache_hits_from_ic_misses,l2_cache_hits_from_l2_hwpf,l2_cache_misses_from_dc_misses,l2_cache_misses_from_ic_miss,l2_dtlb_misses,l2_itlb_misses,sse_avx_stalls,uops_dispatched,uops_retired,l2_cache_accesses_from_dc_misses,l2_cache_accesses_from_ic_misses,l2_cache_hits_from_dc_misses,l2_cache_hits_from_ic_misses,l2_cache_hits_from_l2_hwpf,l2_cache_misses_from_dc_misses,l2_cache_misses_from_ic_miss,l2_dtlb_misses,l2_itlb_misses,l2_cache_req_stat.ic_access_in_l2,l2_cache_req_stat.ic_dc_hit_in_l2,l2_cache_req_stat.ic_dc_miss_in_l2,l2_cache_req_stat.ic_fill_hit_s,l2_cache_req_stat.ic_fill_hit_x,l2_cache_req_stat.ic_fill_miss,l2_cache_req_stat.ls_rd_blk_c,l2_cache_req_stat.ls_rd_blk_cs,l2_cache_req_stat.ls_rd_blk_l_hit_s,l2_cache_req_stat.ls_rd_blk_l_hit_x,l2_cache_req_stat.ls_rd_blk_x,l2_fill_pending.l2_fill_busy,l2_latency.l2_cycles_waiting_on_fills,l2_pf_hit_l2,l2_pf_miss_l2_hit_l3,l2_pf_miss_l2_l3,l2_request_g1.all_no_prefetch,l2_request_g1.cacheable_ic_read,l2_request_g1.change_to_x,l2_request_g1.group2,l2_request_g1.l2_hw_pf,l2_request_g1.ls_rd_blk_c_s,l2_request_g1.prefetch_l2_cmd,l2_request_g1.rd_blk_l,l2_request_g1.rd_blk_x,l2_request_g2.bus_locks_originator,l2_request_g2.bus_locks_responses,l2_request_g2.group1 \
sleep 10
```

## References

### `perf list` from Hetzner VM

devops@feat3-lg1k-hzax41:~/beacon$ perf list

List of pre-defined events (to be used in -e):

  duration_time                                      [Tool event]

  branch-instructions OR cpu/branch-instructions/    [Kernel PMU event]
  branch-misses OR cpu/branch-misses/                [Kernel PMU event]
  cache-misses OR cpu/cache-misses/                  [Kernel PMU event]
  cache-references OR cpu/cache-references/          [Kernel PMU event]
  cpu-cycles OR cpu/cpu-cycles/                      [Kernel PMU event]
  instructions OR cpu/instructions/                  [Kernel PMU event]
  stalled-cycles-backend OR cpu/stalled-cycles-backend/ [Kernel PMU event]
  stalled-cycles-frontend OR cpu/stalled-cycles-frontend/ [Kernel PMU event]
  msr/aperf/                                         [Kernel PMU event]
  msr/irperf/                                        [Kernel PMU event]
  msr/mperf/                                         [Kernel PMU event]
  msr/tsc/                                           [Kernel PMU event]
  power/energy-pkg/                                  [Kernel PMU event]

branch:
  bp_de_redirect
       [Decoder Overrides Existing Branch Prediction (speculative)]
  bp_dyn_ind_pred
       [Dynamic Indirect Predictions]
  bp_l1_btb_correct
       [L1 Branch Prediction Overrides Existing Prediction (speculative)]
  bp_l1_tlb_fetch_hit
       [The number of instruction fetches that hit in the L1 ITLB]
  bp_l1_tlb_fetch_hit.if1g
       [The number of instruction fetches that hit in the L1 ITLB. Instruction fetches to a 1GB page]
  bp_l1_tlb_fetch_hit.if2m
       [The number of instruction fetches that hit in the L1 ITLB. Instruction fetches to a 2MB page]
  bp_l1_tlb_fetch_hit.if4k
       [The number of instruction fetches that hit in the L1 ITLB. Instruction fetches to a 4KB page]
  ic_cache_inval.fill_invalidated
       [IC line invalidated due to overwriting fill response. The number of instruction cache lines invalidated. A non-SMC event is CMC (cross
        modifying code), either from the other thread of the core or another core]
  ic_cache_inval.l2_invalidating_probe
       [IC line invalidated due to L2 invalidating probe (external or LS). The number of instruction cache lines invalidated. A non-SMC event
        is CMC (cross modifying code), either from the other thread of the core or another core]
  ic_fetch_stall.ic_stall_any
       [Instruction Pipe Stall. IC pipe was stalled during this clock cycle for any reason (nothing valid in pipe ICM1)]
  ic_fetch_stall.ic_stall_back_pressure
       [Instruction Pipe Stall. IC pipe was stalled during this clock cycle (including IC to OC fetches) due to back-pressure]
  ic_fetch_stall.ic_stall_dq_empty
       [Instruction Pipe Stall. IC pipe was stalled during this clock cycle (including IC to OC fetches) due to DQ empty]
  ic_fw32
       [The number of 32B fetch windows transferred from IC pipe to DE instruction decoder (includes non-cacheable and cacheable fill
        responses)]
  ic_fw32_miss
       [The number of 32B fetch windows tried to read the L1 IC and missed in the full tag]
  ic_oc_mode_switch.ic_oc_mode_switch
       [OC Mode Switch. IC to OC mode switch]
  ic_oc_mode_switch.oc_ic_mode_switch
       [OC Mode Switch. OC to IC mode switch]
  l2_cache_req_stat.ic_access_in_l2
       [Core to L2 cacheable request access status (not including L2 Prefetch). Instruction cache requests in L2]
  l2_cache_req_stat.ic_dc_hit_in_l2
       [Core to L2 cacheable request access status (not including L2 Prefetch). Instruction cache request hit in L2 and Data cache request hit
        in L2 (all types)]
  l2_cache_req_stat.ic_dc_miss_in_l2
       [Core to L2 cacheable request access status (not including L2 Prefetch). Instruction cache request miss in L2 and Data cache request
        miss in L2 (all types)]
  l2_cache_req_stat.ic_fill_hit_s
       [Core to L2 cacheable request access status (not including L2 Prefetch). Instruction cache hit clean line in L2]
  l2_cache_req_stat.ic_fill_hit_x
       [Core to L2 cacheable request access status (not including L2 Prefetch). Instruction cache hit modifiable line in L2]
  l2_cache_req_stat.ic_fill_miss
       [Core to L2 cacheable request access status (not including L2 Prefetch). Instruction cache request miss in L2]
  l2_cache_req_stat.ls_rd_blk_c
       [Core to L2 cacheable request access status (not including L2 Prefetch). Data cache request miss in L2 (all types)]
  l2_cache_req_stat.ls_rd_blk_cs
       [Core to L2 cacheable request access status (not including L2 Prefetch). Data cache shared read hit in L2]
  l2_cache_req_stat.ls_rd_blk_l_hit_s
       [Core to L2 cacheable request access status (not including L2 Prefetch). Data cache read hit on shared line in L2]
  l2_cache_req_stat.ls_rd_blk_l_hit_x
       [Core to L2 cacheable request access status (not including L2 Prefetch). Data cache read hit in L2]
  l2_cache_req_stat.ls_rd_blk_x
       [Core to L2 cacheable request access status (not including L2 Prefetch). Data cache store or state change hit in L2]
  l2_fill_pending.l2_fill_busy
       [Cycles with fill pending from L2. Total cycles spent with one or more fill requests in flight from L2]
  l2_latency.l2_cycles_waiting_on_fills
       [Total cycles spent waiting for L2 fills to complete from L3 or memory, divided by four. Event counts are for both threads. To
        calculate average latency, the number of fills from both threads must be used]
  l2_pf_hit_l2
       [L2 prefetch hit in L2. Use l2_cache_hits_from_l2_hwpf instead]
  l2_pf_miss_l2_hit_l3
       [L2 prefetcher hits in L3. Counts all L2 prefetches accepted by the L2 pipeline which miss the L2 cache and hit the L3]
  l2_pf_miss_l2_l3
       [L2 prefetcher misses in L3. All L2 prefetches accepted by the L2 pipeline which miss the L2 and the L3 caches]
  l2_request_g1.all_no_prefetch
       [(null)]
  l2_request_g1.cacheable_ic_read
       [All L2 Cache Requests (Breakdown 1 - Common). Instruction cache reads]
  l2_request_g1.change_to_x
       [All L2 Cache Requests (Breakdown 1 - Common). Data cache state change requests. Request change to writable, check L2 for current state]
  l2_request_g1.group2
       [Miscellaneous events covered in more detail by l2_request_g2 (PMCx061)]
  l2_request_g1.l2_hw_pf
       [All L2 Cache Requests (Breakdown 1 - Common). L2 Prefetcher. All prefetches accepted by L2 pipeline, hit or miss. Types of PF and L2
        hit/miss broken out in a separate perfmon event]
  l2_request_g1.ls_rd_blk_c_s
       [All L2 Cache Requests (Breakdown 1 - Common). Data cache shared reads]
  l2_request_g1.prefetch_l2_cmd
       [All L2 Cache Requests (Breakdown 1 - Common). PrefetchL2Cmd]
  l2_request_g1.rd_blk_l
       [All L2 Cache Requests (Breakdown 1 - Common). Data cache reads (including hardware and software prefetch)]
  l2_request_g1.rd_blk_x
       [All L2 Cache Requests (Breakdown 1 - Common). Data cache stores]
  l2_request_g2.bus_locks_originator
       [All L2 Cache Requests (Breakdown 2 - Rare). Bus locks]
  l2_request_g2.bus_locks_responses
       [All L2 Cache Requests (Breakdown 2 - Rare). Bus lock response]
  l2_request_g2.group1
       [Miscellaneous events covered in more detail by l2_request_g1 (PMCx060)]
  l2_request_g2.ic_rd_sized
       [All L2 Cache Requests (Breakdown 2 - Rare). Instruction cache read sized]
  l2_request_g2.ic_rd_sized_nc
       [All L2 Cache Requests (Breakdown 2 - Rare). Instruction cache read sized non-cacheable]
  l2_request_g2.ls_rd_sized
       [All L2 Cache Requests (Breakdown 2 - Rare). Data cache read sized]
  l2_request_g2.ls_rd_sized_nc
       [All L2 Cache Requests (Breakdown 2 - Rare). Data cache read sized non-cacheable]
  l2_request_g2.smc_inval
       [All L2 Cache Requests (Breakdown 2 - Rare). Self-modifying code invalidates]
  l2_wcb_req.cl_zero
       [LS to L2 WCB cache line zeroing requests. LS (Load/Store unit) to L2 WCB (Write Combining Buffer) cache line zeroing requests]
  l2_wcb_req.wcb_close
       [LS to L2 WCB close requests. LS (Load/Store unit) to L2 WCB (Write Combining Buffer) close requests]
  l2_wcb_req.wcb_write
       [LS to L2 WCB write requests. LS (Load/Store unit) to L2 WCB (Write Combining Buffer) write requests]
  l2_wcb_req.zero_byte_store
       [LS to L2 WCB zero byte store requests. LS (Load/Store unit) to L2 WCB (Write Combining Buffer) zero byte store requests]

core:
  ex_div_busy
       [Div Cycles Busy count]
  ex_div_count
       [Div Op Count]
  ex_ret_brn
       [Retired Branch Instructions]
  ex_ret_brn_far
       [Retired Far Control Transfers]
  ex_ret_brn_ind_misp
       [Retired Indirect Branch Instructions Mispredicted]
  ex_ret_brn_misp
       [Retired Branch Instructions Mispredicted]
  ex_ret_brn_resync
       [Retired Branch Resyncs]
  ex_ret_brn_tkn
       [Retired Taken Branch Instructions]
  ex_ret_brn_tkn_misp
       [Retired Taken Branch Instructions Mispredicted]
  ex_ret_cond
       [Retired Conditional Branch Instructions]
  ex_ret_cond_misp
       [Retired Conditional Branch Instructions Mispredicted]
  ex_ret_cops
       [Retired Uops]
  ex_ret_fus_brnch_inst
       [Retired Fused Instructions. The number of fuse-branch instructions retired per cycle. The number of events logged per cycle can vary
        from 0-8]
  ex_ret_instr
       [Retired Instructions]
  ex_ret_mmx_fp_instr.mmx_instr
       [MMX instructions]
  ex_ret_mmx_fp_instr.sse_instr
       [SSE instructions (SSE, SSE2, SSE3, SSSE3, SSE4A, SSE41, SSE42, AVX)]
  ex_ret_mmx_fp_instr.x87_instr
       [x87 instructions]
  ex_ret_near_ret
       [Retired Near Returns]
  ex_ret_near_ret_mispred
       [Retired Near Returns Mispredicted]
  ex_tagged_ibs_ops.ibs_count_rollover
       [Tagged IBS Ops. Number of times an op could not be tagged by IBS because of a previous tagged op that has not retired]
  ex_tagged_ibs_ops.ibs_tagged_ops
       [Tagged IBS Ops. Number of Ops tagged by IBS]
  ex_tagged_ibs_ops.ibs_tagged_ops_ret
       [Tagged IBS Ops. Number of Ops tagged by IBS that retired]

floating point:
  fp_disp_faults.x87_fill_fault
       [Floating Point Dispatch Faults. x87 fill fault]
  fp_disp_faults.xmm_fill_fault
       [Floating Point Dispatch Faults. XMM fill fault]
  fp_disp_faults.ymm_fill_fault
       [Floating Point Dispatch Faults. YMM fill fault]
  fp_disp_faults.ymm_spill_fault
       [Floating Point Dispatch Faults. YMM spill fault]
  fp_num_mov_elim_scal_op.opt_potential
       [Number of Ops that are candidates for optimization (have Z-bit either set or pass). This is a dispatch based speculative event, and is
        useful for measuring the effectiveness of the Move elimination and Scalar code optimization schemes]
  fp_num_mov_elim_scal_op.optimized
       [Number of Scalar Ops optimized. This is a dispatch based speculative event, and is useful for measuring the effectiveness of the Move
        elimination and Scalar code optimization schemes]
  fp_num_mov_elim_scal_op.sse_mov_ops
       [Number of SSE Move Ops. This is a dispatch based speculative event, and is useful for measuring the effectiveness of the Move
        elimination and Scalar code optimization schemes]
  fp_num_mov_elim_scal_op.sse_mov_ops_elim
       [Number of SSE Move Ops eliminated. This is a dispatch based speculative event, and is useful for measuring the effectiveness of the
        Move elimination and Scalar code optimization schemes]
  fp_ret_sse_avx_ops.add_sub_flops
       [Add/subtract FLOPS. This is a retire-based event. The number of retired SSE/AVX FLOPS. The number of events logged per cycle can vary
        from 0 to 64. This event can count above 15]
  fp_ret_sse_avx_ops.all
       [All FLOPS. This is a retire-based event. The number of retired SSE/AVX FLOPS. The number of events logged per cycle can vary from 0 to
        64. This event can count above 15]
  fp_ret_sse_avx_ops.div_flops
       [Divide/square root FLOPS. This is a retire-based event. The number of retired SSE/AVX FLOPS. The number of events logged per cycle can
        vary from 0 to 64. This event can count above 15]
  fp_ret_sse_avx_ops.mac_flops
       [Multiply-add FLOPS. Multiply-add counts as 2 FLOPS. This is a retire-based event. The number of retired SSE/AVX FLOPS. The number of
        events logged per cycle can vary from 0 to 64. This event can count above 15]
  fp_ret_sse_avx_ops.mult_flops
       [Multiply FLOPS. This is a retire-based event. The number of retired SSE/AVX FLOPS. The number of events logged per cycle can vary from
        0 to 64. This event can count above 15]
  fp_retired_ser_ops.sse_bot_ret
       [SSE bottom-executing uOps retired. The number of serializing Ops retired]
  fp_retired_ser_ops.sse_ctrl_ret
       [The number of serializing Ops retired. SSE control word mispredict traps due to mispredictions in RC, FTZ or DAZ, or changes in mask
        bits]
  fp_retired_ser_ops.x87_bot_ret
       [x87 bottom-executing uOps retired. The number of serializing Ops retired]
  fp_retired_ser_ops.x87_ctrl_ret
       [x87 control word mispredict traps due to mispredictions in RC or PC, or changes in mask bits. The number of serializing Ops retired]
  fpu_pipe_assignment.total
       [Total number of fp uOps]
  fpu_pipe_assignment.total0
       [Total number of fp uOps on pipe 0]
  fpu_pipe_assignment.total1
       [Total number uOps assigned to pipe 1]
  fpu_pipe_assignment.total2
       [Total number uOps assigned to pipe 2]
  fpu_pipe_assignment.total3
       [Total number uOps assigned to pipe 3]

memory:
  ls_bad_status2.stli_other
       [Non-forwardable conflict; used to reduce STLI's via software. All reasons. Store To Load Interlock (STLI) are loads that were unable
        to complete because of a possible match with an older store, and the older store could not do STLF for some reason]
  ls_dc_accesses
       [Number of accesses to the dcache for load/store references]
  ls_dispatch.ld_dispatch
       [Number of loads dispatched. Counts the number of operations dispatched to the LS unit. Unit Masks ADDed]
  ls_dispatch.ld_st_dispatch
       [Dispatch of a single op that performs a load from and store to the same memory address. Number of single ops that do load/store to an
        address]
  ls_dispatch.store_dispatch
       [Number of stores dispatched. Counts the number of operations dispatched to the LS unit. Unit Masks ADDed]
  ls_hw_pf_dc_fill.ls_mabresp_lcl_cache
       [Hardware Prefetch Data Cache Fills by Data Source. From another cache (home node local)]
  ls_hw_pf_dc_fill.ls_mabresp_lcl_dram
       [Hardware Prefetch Data Cache Fills by Data Source. From DRAM (home node local)]
  ls_hw_pf_dc_fill.ls_mabresp_lcl_l2
       [Hardware Prefetch Data Cache Fills by Data Source. Local L2 hit]
  ls_hw_pf_dc_fill.ls_mabresp_rmt_cache
       [Hardware Prefetch Data Cache Fills by Data Source. From another cache (home node remote)]
  ls_hw_pf_dc_fill.ls_mabresp_rmt_dram
       [Hardware Prefetch Data Cache Fills by Data Source. From DRAM (home node remote)]
  ls_inef_sw_pref.data_pipe_sw_pf_dc_hit
       [The number of software prefetches that did not fetch data outside of the processor core. Software PREFETCH instruction saw a DC hit]
  ls_inef_sw_pref.mab_mch_cnt
       [The number of software prefetches that did not fetch data outside of the processor core. Software PREFETCH instruction saw a match on
        an already-allocated miss request buffer]
  ls_int_taken
       [Number of interrupts taken]
  ls_l1_d_tlb_miss.all
       [All L1 DTLB Misses or Reloads]
  ls_l1_d_tlb_miss.tlb_reload_1g_l2_hit
       [L1 DTLB Miss. DTLB reload to a 1G page that hit in the L2 TLB]
  ls_l1_d_tlb_miss.tlb_reload_1g_l2_miss
       [L1 DTLB Miss. DTLB reload to a 1G page that miss in the L2 TLB]
  ls_l1_d_tlb_miss.tlb_reload_2m_l2_hit
       [L1 DTLB Miss. DTLB reload to a 2M page that hit in the L2 TLB]
  ls_l1_d_tlb_miss.tlb_reload_2m_l2_miss
       [L1 DTLB Miss. DTLB reload to a 2M page that miss in the L2 TLB]
  ls_l1_d_tlb_miss.tlb_reload_4k_l2_hit
       [L1 DTLB Miss. DTLB reload to a 4K page that hit in the L2 TLB]
  ls_l1_d_tlb_miss.tlb_reload_4k_l2_miss
       [L1 DTLB Miss. DTLB reload to a 4K page that miss the L2 TLB]
  ls_l1_d_tlb_miss.tlb_reload_coalesced_page_hit
       [L1 DTLB Miss. DTLB reload hit a coalesced page]
  ls_l1_d_tlb_miss.tlb_reload_coalesced_page_miss
       [L1 DTLB Miss. DTLB reload coalesced page miss]
  ls_locks.bus_lock
       [Retired lock instructions. Bus lock when a locked operations crosses a cache boundary or is done on an uncacheable memory type.
        Comparable to legacy bus lock]
  ls_locks.non_spec_lock
       [Retired lock instructions. Non-speculative lock succeeded]
  ls_locks.spec_lock_hi_spec
       [Retired lock instructions. High speculative cacheable lock speculation succeeded]
  ls_locks.spec_lock_lo_spec
       [Retired lock instructions. Low speculative cacheable lock speculation succeeded]
  ls_mab_alloc.dc_prefetcher
       [LS MAB Allocates by Type. DC prefetcher]
  ls_mab_alloc.loads
       [LS MAB Allocates by Type. Loads]
  ls_mab_alloc.stores
       [LS MAB Allocates by Type. Stores]
  ls_misal_accesses
       [Misaligned loads]
  ls_not_halted_cyc
       [Cycles not in Halt]
  ls_pref_instr_disp
       [Software Prefetch Instructions Dispatched (Speculative)]
  ls_pref_instr_disp.prefetch
       [Software Prefetch Instructions Dispatched (Speculative). Prefetch_T0_T1_T2. PrefetchT0, T1 and T2 instructions. See docAPM3
        PREFETCHlevel]
  ls_pref_instr_disp.prefetch_nta
       [Software Prefetch Instructions Dispatched (Speculative). PrefetchNTA instruction. See docAPM3 PREFETCHlevel]
  ls_pref_instr_disp.prefetch_w
       [Software Prefetch Instructions Dispatched (Speculative). See docAPM3 PREFETCHW]
  ls_rdtsc
       [Number of reads of the TSC (RDTSC instructions). The count is speculative]
  ls_refills_from_sys.ls_mabresp_lcl_cache
       [Demand Data Cache Fills by Data Source. Hit in cache; local CCX (not Local L2), or Remote CCX and the address's Home Node is on this
        thread's die]
  ls_refills_from_sys.ls_mabresp_lcl_dram
       [Demand Data Cache Fills by Data Source. DRAM or IO from this thread's die]
  ls_refills_from_sys.ls_mabresp_lcl_l2
       [Demand Data Cache Fills by Data Source. Local L2 hit]
  ls_refills_from_sys.ls_mabresp_rmt_cache
       [Demand Data Cache Fills by Data Source. Hit in cache; Remote CCX and the address's Home Node is on a different die]
  ls_refills_from_sys.ls_mabresp_rmt_dram
       [Demand Data Cache Fills by Data Source. DRAM or IO from different die]
  ls_ret_cl_flush
       [Number of retired CLFLUSH instructions]
  ls_ret_cpuid
       [Number of retired CPUID instructions]
  ls_smi_rx
       [Number of SMIs received]
  ls_st_commit_cancel2.st_commit_cancel_wcb_full
       [A non-cacheable store and the non-cacheable commit buffer is full]
  ls_stlf
       [Number of STLF hits]
  ls_sw_pf_dc_fill.ls_mabresp_lcl_cache
       [Software Prefetch Data Cache Fills by Data Source. From another cache (home node local)]
  ls_sw_pf_dc_fill.ls_mabresp_lcl_dram
       [Software Prefetch Data Cache Fills by Data Source. DRAM or IO from this thread's die. From DRAM (home node local)]
  ls_sw_pf_dc_fill.ls_mabresp_lcl_l2
       [Software Prefetch Data Cache Fills by Data Source. Local L2 hit]
  ls_sw_pf_dc_fill.ls_mabresp_rmt_cache
       [Software Prefetch Data Cache Fills by Data Source. From another cache (home node remote)]
  ls_sw_pf_dc_fill.ls_mabresp_rmt_dram
       [Software Prefetch Data Cache Fills by Data Source. From DRAM (home node remote)]
  ls_tablewalker.dc_type0
       [Total Page Table Walks DC Type 0]
  ls_tablewalker.dc_type1
       [Total Page Table Walks DC Type 1]
  ls_tablewalker.dside
       [Total Page Table Walks on D-side]
  ls_tablewalker.ic_type0
       [Total Page Table Walks IC Type 0]
  ls_tablewalker.ic_type1
       [Total Page Table Walks IC Type 1]
  ls_tablewalker.iside
       [Total Page Table Walks on I-side]
  ls_tlb_flush
       [All TLB Flushes]

other:
  de_dis_dispatch_token_stalls0.agsq_token_stall
       [Cycles where a dispatch group is valid but does not get dispatched due to a token stall. AGSQ Tokens unavailable]
  de_dis_dispatch_token_stalls0.alsq1_token_stall
       [Cycles where a dispatch group is valid but does not get dispatched due to a token stall. ALSQ 1 Tokens unavailable]
  de_dis_dispatch_token_stalls0.alsq2_token_stall
       [Cycles where a dispatch group is valid but does not get dispatched due to a token stall. ALSQ 2 Tokens unavailable]
  de_dis_dispatch_token_stalls0.alsq3_0_token_stall
       [Cycles where a dispatch group is valid but does not get dispatched due to a token stall. ALSQ3_0_TokenStall]
  de_dis_dispatch_token_stalls0.alu_token_stall
       [Cycles where a dispatch group is valid but does not get dispatched due to a token stall. ALU tokens total unavailable]
  de_dis_dispatch_token_stalls0.retire_token_stall  
       [Cycles where a dispatch group is valid but does not get dispatched due to a token stall. RETIRE Tokens unavailable]
  de_dis_dispatch_token_stalls0.sc_agu_dispatch_stall
       [Cycles where a dispatch group is valid but does not get dispatched due to a token stall. SC AGU dispatch stall]
  de_dis_dispatch_token_stalls1.fp_misc_rsrc_stall  
       [Cycles where a dispatch group is valid but does not get dispatched due to a token stall. FP Miscellaneous resource unavailable.
        Applies to the recovery of mispredicts with FP ops]
  de_dis_dispatch_token_stalls1.fp_reg_file_rsrc_stall
       [Cycles where a dispatch group is valid but does not get dispatched due to a token stall. Floating point register file resource stall.
        Applies to all FP ops that have a destination register]
  de_dis_dispatch_token_stalls1.fp_sch_rsrc_stall
       [Cycles where a dispatch group is valid but does not get dispatched due to a token stall. FP scheduler resource stall. Applies to ops
        that use the FP scheduler]
  de_dis_dispatch_token_stalls1.int_phy_reg_file_token_stall
       [Cycles where a dispatch group is valid but does not get dispatched due to a token stall. Integer Physical Register File resource
        stall. Applies to all ops that have an integer destination register]
  de_dis_dispatch_token_stalls1.int_sched_misc_token_stall
       [Cycles where a dispatch group is valid but does not get dispatched due to a token stall. Integer Scheduler miscellaneous resource
        stall]
  de_dis_dispatch_token_stalls1.load_queue_token_stall
       [Cycles where a dispatch group is valid but does not get dispatched due to a token stall. Load queue resource stall. Applies to all ops
        with load semantics]
  de_dis_dispatch_token_stalls1.store_queue_token_stall
       [Cycles where a dispatch group is valid but does not get dispatched due to a token stall. Store queue resource stall. Applies to all
        ops with store semantics]
  de_dis_dispatch_token_stalls1.taken_branch_buffer_rsrc_stall
       [Cycles where a dispatch group is valid but does not get dispatched due to a token stall. Taken branch buffer resource stall]
  de_dis_uop_queue_empty_di0
       [Cycles where the Micro-Op Queue is empty]
  de_dis_uops_from_decoder
       [Ops dispatched from either the decoders, OpCache or both]
  de_dis_uops_from_decoder.decoder_dispatched
       [Count of dispatched Ops from Decoder]
  de_dis_uops_from_decoder.opcache_dispatched
       [Count of dispatched Ops from OpCache]

recommended:
  all_dc_accesses
       [All L1 Data Cache Accesses]
  all_tlbs_flushed
       [All TLBs Flushed]
  l1_dtlb_misses
       [L1 DTLB Misses]
  l2_cache_accesses_from_dc_misses
       [L2 Cache Accesses from L1 Data Cache Misses (including prefetch)]
  l2_cache_accesses_from_ic_misses
       [L2 Cache Accesses from L1 Instruction Cache Misses (including prefetch)]
  l2_cache_hits_from_dc_misses
       [L2 Cache Hits from L1 Data Cache Misses]
  l2_cache_hits_from_ic_misses
       [L2 Cache Hits from L1 Instruction Cache Misses]
  l2_cache_hits_from_l2_hwpf
       [L2 Cache Hits from L2 HWPF]
  l2_cache_misses_from_dc_misses
       [L2 Cache Misses from L1 Data Cache Misses]
  l2_cache_misses_from_ic_miss
       [L2 Cache Misses from L1 Instruction Cache Misses]
  l2_dtlb_misses
       [L2 DTLB Misses & Data page walks]
  l2_itlb_misses
       [L2 ITLB Misses & Instruction page walks]
  sse_avx_stalls
       [Mixed SSE/AVX Stalls]
  uops_dispatched
       [Micro-ops Dispatched]
  uops_retired
       [Micro-ops Retired]

  rNNN                                               [Raw hardware event descriptor]
  cpu/t1=v1[,t2=v2,t3 ...]/modifier                  [Raw hardware event descriptor]
   (see 'man perf-list' on how to encode it)

  mem:<addr>[/len][:access]                          [Hardware breakpoint]

Metric Groups:

branch_prediction:
  branch_misprediction_ratio
       [Execution-Time Branch Misprediction Ratio (Non-Speculative)]
data_fabric:
  all_remote_links_outbound
       [Approximate: Outbound data bytes for all Remote Links for a node (die)]
  nps1_die_to_dram
       [Approximate: Combined DRAM B/bytes of all channels on a NPS1 node (die) (may need --metric-no-group)]
l2_cache:
  all_l2_cache_accesses
       [All L2 Cache Accesses]
  all_l2_cache_hits
       [All L2 Cache Hits]
  all_l2_cache_misses
       [All L2 Cache Misses]
  ic_fetch_miss_ratio
       [L1 Instruction Cache (32B) Fetch Miss Ratio]
  l2_cache_accesses_from_l2_hwpf
       [L2 Cache Accesses from L2 HWPF]
  l2_cache_misses_from_l2_hwpf
       [L2 Cache Misses from L2 HWPF]
l3_cache:
  l3_read_miss_latency
       [Average L3 Read Miss Latency (in core clocks)]
tlb:
  l1_itlb_misses
       [L1 ITLB Misses]
(END)
