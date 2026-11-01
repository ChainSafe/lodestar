// Deterministic process clock and entropy for fuzz harnesses, loaded with LD_PRELOAD
// (AFL_PRELOAD under afl-fuzz). The clock replaces the libc reads that quiche's timers depend
// on with a counter held in this process's own memory: it starts at a fixed instant, moves only
// when the harness calls fuzz_clock_advance (or by FUZZ_CLOCK_STEP_NS per read when that is
// set), and a fork child inherits the parent's value by copy, so every snapshot child starts at
// the same time and advances independently of its siblings. The entropy replaces getrandom,
// getentropy and the raw getrandom syscall with a generator in the same memory: BoringSSL
// reseeds itself after it detects a fork, so without this every snapshot child's handshake
// drew different TLS randoms and the coverage map varied run to run.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/random.h>
#include <sys/syscall.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

// 2026-01-01T00:00:00Z for the realtime clocks; the monotonic clocks start at one second so
// callers that subtract an epoch never see zero.
static const int64_t realtime_base_ns = 1767225600LL * 1000000000LL;
static const int64_t monotonic_base_ns = 1000000000LL;
static int64_t elapsed_ns = 0;
static int64_t step_ns = -1;

static int64_t read_clock(clockid_t id) {
  if (step_ns < 0) {
    const char* step = getenv("FUZZ_CLOCK_STEP_NS");
    step_ns = step ? atoll(step) : 0;
    if (step_ns < 0) step_ns = 0;
  }
  elapsed_ns += step_ns;
  switch (id) {
    case CLOCK_REALTIME:
    case CLOCK_REALTIME_COARSE:
      return realtime_base_ns + elapsed_ns;
    default:
      return monotonic_base_ns + elapsed_ns;
  }
}

void fuzz_clock_advance(int64_t ns) {
  if (ns > 0) elapsed_ns += ns;
}

int clock_gettime(clockid_t id, struct timespec* ts) {
  const int64_t now = read_clock(id);
  ts->tv_sec = now / 1000000000LL;
  ts->tv_nsec = now % 1000000000LL;
  return 0;
}

int gettimeofday(struct timeval* tv, void* tz) {
  (void)tz;
  const int64_t now = read_clock(CLOCK_REALTIME);
  tv->tv_sec = now / 1000000000LL;
  tv->tv_usec = (now % 1000000000LL) / 1000;
  return 0;
}

time_t time(time_t* out) {
  const time_t now = read_clock(CLOCK_REALTIME) / 1000000000LL;
  if (out) *out = now;
  return now;
}

static uint64_t entropy_state = 0x9e3779b97f4a7c15ull;

static void fill_entropy(void* buf, size_t len) {
  unsigned char* out = buf;
  while (len > 0) {
    uint64_t z = (entropy_state += 0x9e3779b97f4a7c15ull);
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ull;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebull;
    z ^= z >> 31;
    const size_t take = len < sizeof z ? len : sizeof z;
    memcpy(out, &z, take);
    out += take;
    len -= take;
  }
}

ssize_t getrandom(void* buf, size_t len, unsigned int flags) {
  (void)flags;
  fill_entropy(buf, len);
  return (ssize_t)len;
}

int getentropy(void* buf, size_t len) {
  if (len > 256) {
    errno = EIO;
    return -1;
  }
  fill_entropy(buf, len);
  return 0;
}

long syscall(long number, ...) {
  va_list ap;
  va_start(ap, number);
  long args[6];
  for (int i = 0; i < 6; i++) args[i] = va_arg(ap, long);
  va_end(ap);
  if (number == SYS_getrandom) {
    fill_entropy((void*)args[0], (size_t)args[1]);
    return args[1];
  }
  static long (*real)(long, ...) = 0;
  if (!real) real = (long (*)(long, ...))dlsym(RTLD_NEXT, "syscall");
  return real(number, args[0], args[1], args[2], args[3], args[4], args[5]);
}
