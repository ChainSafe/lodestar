// The C compiler's layout of quiche_send_info for the build target, which binding.zig checks its own definition
// against.
#include <stddef.h>
#include <quiche.h>

enum {
    send_info_size = sizeof(quiche_send_info),
    send_info_align = _Alignof(quiche_send_info),
    send_info_from = offsetof(quiche_send_info, from),
    send_info_from_len = offsetof(quiche_send_info, from_len),
    send_info_to = offsetof(quiche_send_info, to),
    send_info_to_len = offsetof(quiche_send_info, to_len),
    send_info_at = offsetof(quiche_send_info, at),
    send_info_at_size = sizeof(((quiche_send_info *)0)->at),
    send_info_at_nsec = offsetof(struct timespec, tv_nsec),
};
