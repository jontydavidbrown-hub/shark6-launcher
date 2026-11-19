package au.jonty.shark6.launcher;

import android.content.Context;

import java.io.DataInputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * One connection to the camera helper (see Cameras), shared by every CamView on screen. The
 * helper sends all four cameras on one stream; each frame goes to the views showing that camera.
 */
final class CamFeed {
    interface Status { void status(String text); }

    private static final int MAGIC = 0x5336434D;
    private static final int FPS = 20;
    private static final int POOL = 3;
    private final ByteBuffer[] pool = new ByteBuffer[4 * POOL];
    private final int[] turn = new int[4];

    private final Context context;
    private final Status status;
    private final CamView[] views;
    private volatile boolean wanted;
    private Thread reader;
    private volatile Socket sock;
    private volatile Cameras.Session helper;

    CamFeed(Context c, Status status, CamView... views) {
        this.context = c.getApplicationContext();
        this.status = status;
        this.views = views;
    }

    /** Connect (starting the helper if needed). Safe to call repeatedly. */
    synchronized void start() {
        wanted = true;
        if (reader != null) return;
        reader = new Thread(this::run, "cam-stream");
        reader.start();
    }

    /** Disconnect: the helper then lets go of the cameras so BYD's own views can use them. */
    synchronized void stop() {
        if (!wanted && reader == null) return;
        wanted = false;
        Socket s = sock;
        if (s != null) try { s.close(); } catch (Exception ignored) { }
        if (reader != null) reader.interrupt();
        reader = null;
        new Thread(this::closeHelper, "cam-stop").start();
        for (CamView v : views) v.hide();
    }

    private void run() {
        int backoff = 0;
        while (wanted) {
            status.status("Starting cameras…");
            try {
                helper = Cameras.start(context);
            } catch (InterruptedException e) {
                return;
            } catch (Exception e) {
                status.status("Camera unavailable: " + e.getMessage());
                if (!sleep(Math.min(30000, 3000 + backoff))) return;
                backoff += 3000;
                continue;
            }
            try (Socket s = new Socket()) {
                sock = s;
                s.connect(new InetSocketAddress("127.0.0.1", Cameras.PORT), 2000);
                s.setReceiveBufferSize(4 << 20);
                OutputStream out = s.getOutputStream();
                out.write(FPS);
                out.flush();
                DataInputStream in = new DataInputStream(s.getInputStream());
                byte[] hdr = new byte[16];
                ByteBuffer h = ByteBuffer.wrap(hdr).order(ByteOrder.LITTLE_ENDIAN);
                byte[] buf = null;
                boolean live = false;
                int mask = -1;
                while (wanted) {
                    // Only stream the cameras that are actually on screen.
                    int m = 0;
                    for (CamView v : views) if (v.active()) m |= 1 << (v.slot() & 3);
                    if (m != mask) { mask = m; out.write(0x80 | m); out.flush(); }
                    if (m == 0) { if (!sleep(100)) return; continue; }
                    in.readFully(hdr);
                    if (h.getInt(0) != MAGIC) throw new Exception("bad frame header");
                    int cam = h.getInt(4), w = h.getInt(8), ht = h.getInt(12), n = w * ht * 2;
                    if (n <= 0 || n > 8 << 20) throw new Exception("bad frame size");
                    if (buf == null || buf.length < n) buf = new byte[n];
                    in.readFully(buf, 0, n);
                    ByteBuffer frame = null;
                    for (CamView v : views) {
                        if (v.slot() != cam) continue;
                        if (frame == null) {
                            // Reuse a few direct buffers per camera instead of allocating 1.2 MB a frame.
                            int k = (cam & 3) * POOL + (turn[cam & 3]++ % POOL);
                            if (pool[k] == null || pool[k].capacity() < n) pool[k] = ByteBuffer.allocateDirect(n);
                            frame = pool[k];
                            frame.clear();
                            frame.put(buf, 0, n).position(0);
                        }
                        v.frame(frame, w, ht);
                    }
                    if (frame != null && !live) { live = true; status.status(""); }
                    backoff = 0;
                }
            } catch (Exception e) {
                if (!wanted) return;
                for (CamView v : views) v.hide();
                status.status("Reconnecting cameras…");
                if (!sleep(1000)) return;
            } finally {
                sock = null;
                closeHelper();
            }
        }
    }

    private void closeHelper() {
        Cameras.Session h = helper;
        helper = null;
        if (h != null) h.close();
    }

    private static boolean sleep(int ms) {
        try { Thread.sleep(ms); return true; } catch (InterruptedException e) { return false; }
    }
}
