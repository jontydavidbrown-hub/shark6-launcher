// Shark 6 camera helper. The launcher starts it through the car's own ADB (it must run as the
// shell user, from the app's lib folder, with LD_LIBRARY_PATH=/vendor/lib64:/system/lib64).
//
// It opens the four cameras through Qualcomm's QCarCam client (libais_client.so) and serves
// half-size frames to the launcher on 127.0.0.1:47800 while the launcher's camera view is open.
// It frees the cameras and exits as soon as the launcher disconnects (or never connects), so
// BYD's own reversing and 360 views get the cameras back.
//
// Wire format, helper -> launcher, repeated: 16-byte header then the frame.
//   uint32 magic 'S6CM', uint32 slot (0 front, 1 right, 2 rear, 3 left), uint32 width, uint32 height
//   width*height*2 bytes of UYVY (width 960, height 650)
// Launcher -> helper: one byte at any time = frames per second per camera (1..30),
// or 0x80 | slot mask = which cameras to send.

#include <arpa/inet.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/dma-buf.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define W 1920
#define H 1300
#define STRIDE (W * 2)
#define BYTES (STRIDE * H)
#define NBUF 5
#define FMT_UYVY 0x7080102u
#define OW (W / 2)
#define OH (H / 2)
#define OBYTES (OW * OH * 2)
#define NCAM 4
#define PORT 47800
#define MAGIC 0x5336434Du  // 'S6CM'

static const int CAM_IDS[NCAM] = { 8, 9, 5, 4 };  // front, right, rear, left (checked on the car)

typedef struct { uint32_t width, height, stride, size; int64_t fd; void *virt; uint64_t phys; uint32_t flags, type; uint32_t reserved[8]; } cc_buffer;
typedef struct { uint32_t fmt, flags; cc_buffer *bufs; uint32_t n; } cc_buffers;
typedef struct { uint32_t idx, seq; uint64_t ts; uint32_t flags, field; uint8_t reserved[24]; } cc_frame;

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

typedef struct {
    int slot, id;
    void *h;
    int fds[NBUF];
    void *ptr[NBUF];
    cc_buffer d[NBUF];
    pthread_t thread;
    int running;
    uint32_t phase;
    // Latest half-size frame, handed to the sender.
    pthread_mutex_t lock;
    uint8_t *latest;
    uint32_t latest_no;
} cam_t;

static cam_t cams[NCAM];
static volatile int g_run = 1;
static volatile uint32_t g_fps = 15;
// Which cameras the launcher is showing (bit per slot). Others are neither shrunk nor sent.
static volatile uint32_t g_mask = 0xF;

static void on_signal(int s) { (void)s; g_run = 0; }

static int alloc_buf(int ion, void **ptr) {
    uint32_t heaps[2] = { 1u << 25, 1u << 1 };
    for (int i = 0; ion >= 0 && i < 2; i++) {
        struct ion_alloc a = { BYTES, heaps[i], 1, 0, 0 };
        if (ioctl(ion, ION_ALLOC, &a) < 0) continue;
        void *p = mmap(NULL, BYTES, PROT_READ | PROT_WRITE, MAP_SHARED, (int)a.fd, 0);
        if (p == MAP_FAILED) { close((int)a.fd); continue; }
        *ptr = p;
        return (int)a.fd;
    }
    *ptr = calloc(1, BYTES);
    return -1;
}

// Half size with a 2x2 average (dropping every other pixel made fine detail shimmer and look
// over-sharpened). UYVY: each 4-byte group is U Y0 V Y1, two pixels sharing U and V.
static void shrink(const uint8_t *src, uint8_t *dst) {
    for (int y = 0; y < OH; y++) {
        const uint8_t *a = src + (size_t)(y * 2) * STRIDE, *b = a + STRIDE;
        uint8_t *o = dst + (size_t)y * OW * 2;
        for (int x = 0; x < OW / 2; x++, a += 8, b += 8, o += 4) {
            o[0] = (uint8_t)((a[0] + a[4] + b[0] + b[4] + 2) >> 2);   // U
            o[1] = (uint8_t)((a[1] + a[3] + b[1] + b[3] + 2) >> 2);   // Y0' from Y0,Y1
            o[2] = (uint8_t)((a[2] + a[6] + b[2] + b[6] + 2) >> 2);   // V
            o[3] = (uint8_t)((a[5] + a[7] + b[5] + b[7] + 2) >> 2);   // Y1' from Y2,Y3
        }
    }
}

static void cb(void *h, unsigned int e, void *p) { (void)h; (void)e; (void)p; }

static void *reader(void *arg) {
    cam_t *c = arg;
    while (g_run && c->running) {
        cc_frame fi;
        memset(&fi, 0, sizeof(fi));
        if (cc_get_frame(c->h, &fi, 100000000ULL, 0) != 0) continue;
        c->phase += g_fps;
        if (c->phase >= 30 && fi.idx < NBUF && (g_mask & (1u << c->slot))) {
            c->phase -= 30;
            struct dma_buf_sync s = { DMA_BUF_SYNC_START | DMA_BUF_SYNC_READ };
            if (c->fds[fi.idx] >= 0) ioctl(c->fds[fi.idx], DMA_BUF_IOCTL_SYNC, &s);
            pthread_mutex_lock(&c->lock);
            shrink(c->ptr[fi.idx], c->latest);
            c->latest_no++;
            pthread_mutex_unlock(&c->lock);
            s.flags = DMA_BUF_SYNC_END | DMA_BUF_SYNC_READ;
            if (c->fds[fi.idx] >= 0) ioctl(c->fds[fi.idx], DMA_BUF_IOCTL_SYNC, &s);
        }
        cc_release_frame(c->h, fi.idx);
    }
    return NULL;
}

static int open_cam(cam_t *c, int ion) {
    c->h = cc_open((uint32_t)c->id);
    if (!c->h) { fprintf(stderr, "camera %d: open failed\n", c->id); return -1; }
    struct { void *fn; void *cookie; } cbp = { (void *)cb, NULL };
    cc_s_param(c->h, 1, &cbp);
    uint32_t mask = 0xf;
    cc_s_param(c->h, 2, &mask);
    for (int b = 0; b < NBUF; b++) {
        c->fds[b] = alloc_buf(ion, &c->ptr[b]);
        memset(&c->d[b], 0, sizeof(cc_buffer));
        c->d[b].width = W; c->d[b].height = H; c->d[b].stride = STRIDE; c->d[b].size = BYTES;
        c->d[b].fd = c->fds[b]; c->d[b].virt = c->ptr[b]; c->d[b].type = 1;
    }
    cc_buffers bd = { FMT_UYVY, 0, c->d, NBUF };
    if (cc_s_buffers(c->h, &bd) != 0 || cc_start(c->h) != 0) {
        fprintf(stderr, "camera %d: start failed\n", c->id);
        cc_close(c->h);
        c->h = NULL;
        return -1;
    }
    c->latest = calloc(1, OBYTES);
    pthread_mutex_init(&c->lock, NULL);
    c->running = 1;
    pthread_create(&c->thread, NULL, reader, c);
    return 0;
}

static void close_cam(cam_t *c) {
    if (!c->h) return;
    c->running = 0;
    pthread_join(c->thread, NULL);
    cc_stop(c->h);
    cc_close(c->h);
    c->h = NULL;
    for (int b = 0; b < NBUF; b++) {
        if (c->fds[b] >= 0) { munmap(c->ptr[b], BYTES); close(c->fds[b]); } else free(c->ptr[b]);
    }
    free(c->latest);
}

static int send_all(int fd, const void *p, size_t n) {
    const uint8_t *b = p;
    while (n > 0) {
        ssize_t k = send(fd, b, n, MSG_NOSIGNAL);
        if (k <= 0) { if (k < 0 && errno == EINTR) continue; return -1; }
        b += k; n -= (size_t)k;
    }
    return 0;
}

#define SYM(var, name) do { *(void **)&var = dlsym(lib, name); if (!var) { fprintf(stderr, "missing %s\n", name); return 1; } } while (0)

int main(void) {
    signal(SIGTERM, on_signal);
    signal(SIGINT, on_signal);
    signal(SIGHUP, SIG_IGN);
    signal(SIGPIPE, SIG_IGN);

    // Listen first: a second copy started by mistake fails here and leaves the running one alone.
    int srv = socket(AF_INET, SOCK_STREAM, 0);
    int one = 1;
    setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
    struct sockaddr_in a;
    memset(&a, 0, sizeof(a));
    a.sin_family = AF_INET;
    a.sin_port = htons(PORT);
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    fprintf(stderr, "shark6cam starting, uid %d\n", getuid());
    if (bind(srv, (struct sockaddr *)&a, sizeof(a)) != 0 || listen(srv, 4) != 0) {
        fprintf(stderr, "port %d busy: %s\n", PORT, strerror(errno));
        return 1;
    }

    // Wait for the launcher before touching the cameras. Connections that close without sending
    // the frame-rate byte (the launcher's "is it up yet?" check) don't count. Give up after 10 s idle.
    int cl = -1;
    for (;;) {
        fd_set rs;
        FD_ZERO(&rs); FD_SET(srv, &rs);
        struct timeval tv = { 10, 0 };
        if (select(srv + 1, &rs, NULL, NULL, &tv) <= 0) { fprintf(stderr, "no launcher connection, exiting\n"); return 0; }
        int c = accept(srv, NULL, NULL);
        if (c < 0) continue;
        fd_set r1;
        FD_ZERO(&r1); FD_SET(c, &r1);
        struct timeval t1 = { 2, 0 };
        uint8_t b = 0;
        if (select(c + 1, &r1, NULL, NULL, &t1) > 0 && recv(c, &b, 1, 0) == 1 && b >= 1 && b <= 30) {
            g_fps = b;
            cl = c;
            break;
        }
        close(c);
    }
    close(srv);
    fprintf(stderr, "launcher connected, %u fps\n", g_fps);
    setsockopt(cl, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
    int big = 4 << 20;
    setsockopt(cl, SOL_SOCKET, SO_SNDBUF, &big, sizeof(big));

    void *lib = dlopen("libais_client.so", RTLD_NOW | RTLD_GLOBAL);
    if (!lib) lib = dlopen("/vendor/lib64/libais_client.so", RTLD_NOW | RTLD_GLOBAL);
    if (!lib) { fprintf(stderr, "dlopen: %s\n", dlerror()); return 1; }
    SYM(cc_init, "qcarcam_initialize"); SYM(cc_uninit, "qcarcam_uninitialize");
    SYM(cc_open, "qcarcam_open"); SYM(cc_close, "qcarcam_close");
    SYM(cc_s_buffers, "qcarcam_s_buffers"); SYM(cc_s_param, "qcarcam_s_param");
    SYM(cc_start, "qcarcam_start"); SYM(cc_stop, "qcarcam_stop");
    SYM(cc_get_frame, "qcarcam_get_frame"); SYM(cc_release_frame, "qcarcam_release_frame");
    if ((int)(intptr_t)cc_init(NULL) != 0) { fprintf(stderr, "qcarcam_initialize failed\n"); return 1; }

    int ion = open("/dev/ion", O_RDONLY | O_CLOEXEC);
    int opened = 0;
    fprintf(stderr, "cameras opening\n");
    for (int i = 0; i < NCAM; i++) {
        cams[i].slot = i;
        cams[i].id = CAM_IDS[i];
        if (open_cam(&cams[i], ion) == 0) opened++;
    }

    uint8_t *frame = malloc(OBYTES);
    uint32_t sent_no[NCAM] = { 0 };
    while (g_run && opened > 0) {
        // Rate changes from the launcher; a closed connection ends the helper.
        fd_set r;
        FD_ZERO(&r); FD_SET(cl, &r);
        struct timeval t = { 0, 10000 };
        if (select(cl + 1, &r, NULL, NULL, &t) > 0) {
            uint8_t b;
            ssize_t n = recv(cl, &b, 1, 0);
            if (n <= 0) break;
            if (b >= 1 && b <= 30) g_fps = b;
            else if (b & 0x80) g_mask = b & 0x0F;
        }
        for (int i = 0; i < NCAM && g_run; i++) {
            cam_t *c = &cams[i];
            if (!c->h || c->latest_no == sent_no[i] || !(g_mask & (1u << i))) continue;
            pthread_mutex_lock(&c->lock);
            memcpy(frame, c->latest, OBYTES);
            sent_no[i] = c->latest_no;
            pthread_mutex_unlock(&c->lock);
            uint32_t hdr[4] = { MAGIC, (uint32_t)i, OW, OH };
            if (send_all(cl, hdr, sizeof(hdr)) != 0 || send_all(cl, frame, OBYTES) != 0) { g_run = 0; break; }
        }
    }

    close(cl);
    for (int i = 0; i < NCAM; i++) close_cam(&cams[i]);
    cc_uninit();
    return 0;
}
