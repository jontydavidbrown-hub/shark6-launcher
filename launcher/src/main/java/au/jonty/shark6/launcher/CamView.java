package au.jonty.shark6.launcher;

import android.content.Context;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;

import java.io.DataInputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * Live camera picture for the camera tile. Frames come from the camera helper (see Cameras) as
 * half-size UYVY; a shader turns them into colour. The view sits over the page's #s6-cam box and
 * doesn't take touches, so taps still reach the page (which cycles the camera).
 */
final class CamView extends GLSurfaceView implements GLSurfaceView.Renderer {
    interface Status { void status(String text); }

    private static final int MAGIC = 0x5336434D;
    private static final int FPS = 15;

    private final Status status;
    private final Object lock = new Object();
    private ByteBuffer frame;           // latest frame of the selected camera
    private int fw, fh;
    private boolean fresh;
    private volatile int slot;
    private volatile boolean wanted;
    private Thread reader;
    private Socket sock;

    CamView(Context c, Status status) {
        super(c);
        this.status = status;
        setEGLContextClientVersion(2);
        setRenderer(this);
        setRenderMode(RENDERMODE_WHEN_DIRTY);
        setClickable(false);
        setFocusable(false);
        setVisibility(INVISIBLE);
    }

    void show(int s) { slot = s; }

    /** Connect (starting the helper if needed). Safe to call repeatedly. */
    synchronized void startStream() {
        wanted = true;
        if (reader != null) return;
        reader = new Thread(this::run, "cam-stream");
        reader.start();
    }

    /** Disconnect: the helper then lets go of the cameras so BYD's own views can use them. */
    synchronized void stopStream() {
        wanted = false;
        Socket s = sock;
        if (s != null) try { s.close(); } catch (Exception ignored) { }
        if (reader != null) reader.interrupt();
        reader = null;
        post(() -> setVisibility(INVISIBLE));
    }

    private void run() {
        int backoff = 0;
        while (wanted) {
            status.status("Starting cameras…");
            String err = Cameras.start(getContext());
            if (err != null) {
                status.status("Camera unavailable: " + err);
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
                byte[] skip = null;
                boolean shown = false;
                while (wanted) {
                    in.readFully(hdr);
                    if (h.getInt(0) != MAGIC) throw new Exception("bad frame header");
                    int cam = h.getInt(4), w = h.getInt(8), ht = h.getInt(12), n = w * ht * 2;
                    if (cam == slot) {
                        ByteBuffer b = ByteBuffer.allocateDirect(n);
                        byte[] tmp = new byte[n];
                        in.readFully(tmp);
                        b.put(tmp).position(0);
                        synchronized (lock) { frame = b; fw = w; fh = ht; fresh = true; }
                        requestRender();
                        if (!shown) { shown = true; status.status(""); post(() -> setVisibility(VISIBLE)); }
                    } else {
                        if (skip == null || skip.length < n) skip = new byte[n];
                        in.readFully(skip, 0, n);
                    }
                    backoff = 0;
                }
            } catch (Exception e) {
                if (!wanted) return;
                post(() -> setVisibility(INVISIBLE));
                status.status("Reconnecting cameras…");
                if (!sleep(1000)) return;
            } finally {
                sock = null;
            }
        }
    }

    private static boolean sleep(int ms) {
        try { Thread.sleep(ms); return true; } catch (InterruptedException e) { return false; }
    }

    // ---- GL ----
    private int prog, tex, aPos, uTex, uW;
    private FloatBuffer quad;
    private int vw, vh, tw, th;

    private static final String VS =
            "attribute vec4 p; varying vec2 uv;"
            + "void main(){ gl_Position = vec4(p.xy, 0.0, 1.0); uv = p.zw; }";
    // Each RGBA texel holds two pixels: U Y0 V Y1.
    private static final String FS =
            "precision highp float; varying vec2 uv; uniform sampler2D t; uniform float w;"
            + "void main(){ float px = uv.x * w; vec4 c = texture2D(t, vec2((floor(px / 2.0) + 0.5) * 2.0 / w, uv.y));"
            + " float y = mod(floor(px), 2.0) < 0.5 ? c.g : c.a;"
            + " y = 1.164 * (y - 0.0625); float u = c.r - 0.5, v = c.b - 0.5;"
            + " gl_FragColor = vec4(y + 1.596 * v, y - 0.392 * u - 0.813 * v, y + 2.017 * u, 1.0); }";

    @Override public void onSurfaceCreated(GL10 gl, EGLConfig cfg) {
        prog = GLES20.glCreateProgram();
        GLES20.glAttachShader(prog, shader(GLES20.GL_VERTEX_SHADER, VS));
        GLES20.glAttachShader(prog, shader(GLES20.GL_FRAGMENT_SHADER, FS));
        GLES20.glLinkProgram(prog);
        aPos = GLES20.glGetAttribLocation(prog, "p");
        uTex = GLES20.glGetUniformLocation(prog, "t");
        uW = GLES20.glGetUniformLocation(prog, "w");
        int[] t = new int[1];
        GLES20.glGenTextures(1, t, 0);
        tex = t[0];
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_NEAREST);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_NEAREST);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
        tw = th = 0;
    }

    private static int shader(int type, String src) {
        int s = GLES20.glCreateShader(type);
        GLES20.glShaderSource(s, src);
        GLES20.glCompileShader(s);
        return s;
    }

    @Override public void onSurfaceChanged(GL10 gl, int w, int h) {
        vw = w; vh = h;
        GLES20.glViewport(0, 0, w, h);
        quad = null;
    }

    @Override public void onDrawFrame(GL10 gl) {
        ByteBuffer b; int w, h;
        synchronized (lock) { b = fresh ? frame : null; w = fw; h = fh; fresh = false; }
        GLES20.glClearColor(0f, 0f, 0f, 1f);
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
        if (w == 0) return;
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex);
        if (b != null) {
            if (tw != w / 2 || th != h) {
                tw = w / 2; th = h; quad = null;
                GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, tw, th, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, b);
            } else {
                GLES20.glTexSubImage2D(GLES20.GL_TEXTURE_2D, 0, 0, 0, tw, th, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, b);
            }
        }
        if (quad == null) quad = coverQuad(w, h);
        GLES20.glUseProgram(prog);
        GLES20.glUniform1i(uTex, 0);
        GLES20.glUniform1f(uW, (float) w);
        quad.position(0);
        GLES20.glVertexAttribPointer(aPos, 4, GLES20.GL_FLOAT, false, 16, quad);
        GLES20.glEnableVertexAttribArray(aPos);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
    }

    /** Fill the view, cropping the frame's longer side (like CSS background-size: cover). */
    private FloatBuffer coverQuad(int w, int h) {
        float view = vh == 0 ? 1f : (float) vw / vh, img = (float) w / h;
        float u0 = 0, u1 = 1, v0 = 0, v1 = 1;
        if (img > view) { float k = view / img; u0 = (1 - k) / 2; u1 = 1 - u0; }
        else { float k = img / view; v0 = (1 - k) / 2; v1 = 1 - v0; }
        float[] q = { -1, -1, u0, v1,  1, -1, u1, v1,  -1, 1, u0, v0,  1, 1, u1, v0 };
        FloatBuffer f = ByteBuffer.allocateDirect(q.length * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
        f.put(q).position(0);
        return f;
    }
}
