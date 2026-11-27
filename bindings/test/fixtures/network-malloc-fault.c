// Preloaded into a Node.js process: refuses every malloc of exactly NETWORK_MALLOC_FAULT_BYTES bytes, as an exhausted
// heap would, and passes every other request to glibc.
#include <errno.h>
#include <stdlib.h>

extern void* __libc_malloc(size_t size);

static size_t refused;

__attribute__((constructor)) static void configure(void) {
  const char* bytes = getenv("NETWORK_MALLOC_FAULT_BYTES");
  refused = bytes == NULL ? 0 : strtoull(bytes, NULL, 10);
}

void* malloc(size_t size) {
  if (refused != 0 && size == refused) {
    errno = ENOMEM;
    return NULL;
  }
  return __libc_malloc(size);
}
