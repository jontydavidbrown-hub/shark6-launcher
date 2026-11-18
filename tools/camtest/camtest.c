// Shark 6 camera test: grabs one still from each camera through Qualcomm's QCarCam client
// library (libais_client.so) and saves it as a PPM image. Run it from adb (shell user):
//
//   adb push shark6-camtest /data/local/tmp/ && adb shell chmod 755 /data/local/tmp/shark6-camtest
//   adb shell /data/local/tmp/shark6-camtest            (cameras 8,9,5,4 by default)
//   adb pull /sdcard/Download/shark6-cams
//
// Read-only: it only opens camera streams, never changes car settings.
// Struct layouts and IDs follow the public notes on DiLink 5 (SA8155P) camera access.

#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/dma-buf.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define W 1920
#define H 1300
#define STRIDE (W * 2)
#define BYTES (STRIDE * H)
#define NBUF 5
#define FMT_UYVY 0x7080102u
#define OUT_DIR "/sdcard/Download/shark6-cams"

typedef struct {
    uint32_t width, height, stride, size;
    int64_t fd;
    void *virt;
    uint64_t phys;
    uint32_t flags, type;
    uint32_t reserved[8];
} cc_buffer;  // 80 bytes

typedef struct {
    uint32_t fmt, flags;
    cc_buffer *bufs;
    uint32_t n;
} cc_buffers;

typedef struct {
    uint32_t idx, seq;
    uint64_t ts;
    uint32_t flags, field;
    uint8_t reserved[24];
} cc_frame;  // 48 bytes

static void *(*cc_init)(void *);
static int (*cc_uninit)(void);
static void *(*cc_open)(uint32_t);
static int (*cc_close)(void *);
static int (*cc_s_buffers)(void *, cc_buffers *);
static int (*cc_s_param)(void *, int, void *);
static int (*cc_start)(void *);
static int (*cc_stop)(void *);
static int (*cc_get_frame)(void *, cc_frame *, uint64_t, uint32_t);
static int (*cc_release_frame)(void *, uint32_t);

struct ion_alloc { uint64_t len; uint32_t heap_mask, flags, fd, unused; };
#define ION_ALLOC _IOWR('I', 0, struct ion_alloc)

static int alloc_buf(int ion, void **ptr) {
    uint32_t heaps[2] = { 1u << 25, 1u << 1 };
    for (int i = 0; ion >= 0 && i < 2; i++) {
        struct ion_alloc a = { BYTES, heaps[i], 1, 0, 0 };
        if (ioctl(ion, ION_ALLOC, &a) < 0) { printf("   ion heap 0x%x: %s\n", heaps[i], strerror(errno)); continue; }
        void *p = mmap(NULL, BYTES, PROT_READ | PROT_WRITE, MAP_SHARED, (int)a.fd, 0);
        if (p == MAP_FAILED) { close((int)a.fd); continue; }
        memset(p, 0x80, BYTES);
        *ptr = p;
        return (int)a.fd;
    }
    *ptr = malloc(BYTES);
    if (*ptr) memset(*ptr, 0x80, BYTES);
    return -1;
}

static unsigned char clamp(int v) { return v < 0 ? 0 : v > 255 ? 255 : (unsigned char)v; }

// Half-size RGB still (960x650) from a UYVY frame.
static int save_ppm(const char *path, const uint8_t *src) {
    FILE *f = fopen(path, "wb");
    if (!f) { printf("   can't write %s: %s\n", path, strerror(errno)); return -1; }
    fprintf(f, "P6\n%d %d\n255\n", W / 2, H / 2);
    unsigned char *row = malloc(W / 2 * 3);
    for (int y = 0; y < H; y += 2) {
        const uint8_t *s = src + (size_t)y * STRIDE;
        for (int x = 0; x < W / 2; x++) {
            const uint8_t *q = s + x * 4;  // U Y0 V Y1
            int u = q[0] - 128, yy = q[1] - 16, v = q[2] - 128;
            int c = 298 * yy;
            row[x * 3] = clamp((c + 409 * v + 128) >> 8);
            row[x * 3 + 1] = clamp((c - 100 * u - 208 * v + 128) >> 8);
            row[x * 3 + 2] = clamp((c + 516 * u + 128) >> 8);
        }
        fwrite(row, 1, W / 2 * 3, f);
    }
    free(row);
    fclose(f);
    return 0;
}

static void dummy_cb(void *h, unsigned int e, void *p) { (void)h; (void)e; (void)p; }

#define SYM(var, name) do { *(void **)&var = dlsym(lib, name); if (!var) { printf("missing symbol %s\n", name); return 1; } } while (0)

int main(int argc, char **argv) {
    const char *ids = argc > 1 ? argv[1] : "8,9,5,4";
    setvbuf(stdout, NULL, _IONBF, 0);
    printf("shark6-camtest  uid=%d  cameras=%s\n", getuid(), ids);
    char ctx[128] = {0};
    int cf = open("/proc/self/attr/current", O_RDONLY);
    if (cf >= 0) { read(cf, ctx, sizeof(ctx) - 1); close(cf); }
    printf("selinux context: %s\n", ctx);

    void *lib = dlopen("libais_client.so", RTLD_NOW | RTLD_GLOBAL);
    if (!lib) lib = dlopen("/vendor/lib64/libais_client.so", RTLD_NOW | RTLD_GLOBAL);
    if (!lib) { printf("dlopen failed: %s\n", dlerror()); return 1; }
    printf("libais_client loaded\n");
    SYM(cc_init, "qcarcam_initialize"); SYM(cc_uninit, "qcarcam_uninitialize");
    SYM(cc_open, "qcarcam_open"); SYM(cc_close, "qcarcam_close");
    SYM(cc_s_buffers, "qcarcam_s_buffers"); SYM(cc_s_param, "qcarcam_s_param");
    SYM(cc_start, "qcarcam_start"); SYM(cc_stop, "qcarcam_stop");
    SYM(cc_get_frame, "qcarcam_get_frame"); SYM(cc_release_frame, "qcarcam_release_frame");

    int rc = (int)(intptr_t)cc_init(NULL);
    printf("qcarcam_initialize -> %d\n", rc);
    if (rc != 0) return 1;

    if (mkdir(OUT_DIR, 0777) != 0 && errno != EEXIST) printf("mkdir %s: %s\n", OUT_DIR, strerror(errno));
    int ion = open("/dev/ion", O_RDONLY | O_CLOEXEC);
    printf("/dev/ion: %s\n", ion >= 0 ? "open" : strerror(errno));

    char list[128];
    strncpy(list, ids, sizeof(list) - 1);
    list[sizeof(list) - 1] = 0;
    int ok = 0;
    for (char *t = strtok(list, ","); t; t = strtok(NULL, ",")) {
        int id = atoi(t);
        printf("camera %d:\n", id);
        void *h = cc_open((uint32_t)id);
        if (!h) { printf("   open failed\n"); continue; }
        struct { void *cb; void *cookie; } cb = { (void *)dummy_cb, NULL };
        cc_s_param(h, 1, &cb);
        uint32_t mask = 0xf;
        cc_s_param(h, 2, &mask);

        cc_buffer d[NBUF];
        int fds[NBUF];
        void *ptr[NBUF];
        memset(d, 0, sizeof(d));
        for (int b = 0; b < NBUF; b++) {
            fds[b] = alloc_buf(ion, &ptr[b]);
            d[b].width = W; d[b].height = H; d[b].stride = STRIDE; d[b].size = BYTES;
            d[b].fd = fds[b]; d[b].virt = ptr[b]; d[b].type = 1;
        }
        cc_buffers bd = { FMT_UYVY, 0, d, NBUF };
        rc = cc_s_buffers(h, &bd);
        printf("   s_buffers -> %d\n", rc);
        if (rc == 0) {
            rc = cc_start(h);
            printf("   start -> %d\n", rc);
            if (rc == 0) {
                int got = 0;
                for (int i = 0; i < 30 && got < 10; i++) {  // skip the first frames while exposure settles
                    cc_frame fi;
                    memset(&fi, 0, sizeof(fi));
                    if (cc_get_frame(h, &fi, 500000000ULL, 0) != 0) continue;
                    got++;
                    if (got == 10 && fi.idx < NBUF) {
                        struct dma_buf_sync s = { DMA_BUF_SYNC_START | DMA_BUF_SYNC_READ };
                        if (fds[fi.idx] >= 0) ioctl(fds[fi.idx], DMA_BUF_IOCTL_SYNC, &s);
                        char path[96];
                        snprintf(path, sizeof(path), OUT_DIR "/cam%d.ppm", id);
                        if (save_ppm(path, ptr[fi.idx]) != 0) {
                            snprintf(path, sizeof(path), "/data/local/tmp/cam%d.ppm", id);
                            if (save_ppm(path, ptr[fi.idx]) != 0) { cc_release_frame(h, fi.idx); continue; }
                        }
                        s.flags = DMA_BUF_SYNC_END | DMA_BUF_SYNC_READ;
                        if (fds[fi.idx] >= 0) ioctl(fds[fi.idx], DMA_BUF_IOCTL_SYNC, &s);
                        printf("   saved %s (seq %u)\n", path, fi.seq);
                        ok++;
                    }
                    cc_release_frame(h, fi.idx);
                }
                if (got < 10) printf("   only %d frames arrived\n", got);
                cc_stop(h);
            }
        }
        cc_close(h);
        for (int b = 0; b < NBUF; b++) {
            if (fds[b] >= 0) { munmap(ptr[b], BYTES); close(fds[b]); } else free(ptr[b]);
        }
    }
    cc_uninit();
    printf("done: %d image(s) in " OUT_DIR "\n", ok);
    return ok ? 0 : 2;
}
