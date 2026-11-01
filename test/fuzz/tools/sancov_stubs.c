// quiche carries sanitizer-coverage guards for the AFL harnesses; the harness unit tests link
// it without the AFL runtime, so they take these no-op callbacks instead.
#include <stdint.h>

void __sanitizer_cov_trace_pc_guard_init(uint32_t* start, uint32_t* stop) {
  (void)start;
  (void)stop;
}

void __sanitizer_cov_trace_pc_guard(uint32_t* guard) { (void)guard; }
