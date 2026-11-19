package au.jonty.shark6.launcher;

import android.content.Context;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * Live picture for one camera tile. Frames arrive from CamFeed as half-size UYVY; a shader turns
 * them into colour. The view sits over its tile's box on the page and doesn't take touches, so
 * taps still reach the page (which switches the camera).
 */
final class CamView extends GLSurfaceView implements GLSurfaceView.Renderer {
    private final Object lock = new Object();
    private ByteBuffer frame;           // latest frame of the selected camera
    private int fw, fh;
    private boolean fresh;
    private volatile int slot;
    private volatile boolean shown;
    private volatile boolean active;

    CamView(Context c, int slot) {
        super(c);
        this.slot = slot;
        setEGLContextClientVersion(2);
        setRenderer(this);
        setRenderMode(RENDERMODE_WHEN_DIRTY);
        setClickable(false);
        setFocusable(false);
        setVisibility(INVISIBLE);
    }

    int slot() { return slot; }

    /** Whether this view's box is on the page; only active views' cameras are streamed. */
    void setActive(boolean a) { active = a; }
    boolean active() { return active; }

    /** Switch camera. The old picture stays until the new camera's first frame arrives. */
    void show(int s) { slot = s; }

    /** Called on the feed thread with a frame for this view's camera. */
    void frame(ByteBuffer b, int w, int h) {
        synchronized (lock) { frame = b; fw = w; fh = h; fresh = true; }
        requestRender();
        if (!shown) { shown = true; post(() -> setVisibility(VISIBLE)); }
    }

    void hide() {
        shown = false;
        post(() -> setVisibility(INVISIBLE));
    }

    // ---- GL ----
    private int prog, tex, aPos, uTex, uW, uH, uHalf, uFoot;
    private float halfU = 0.5f, halfV = 0.5f;
    private FloatBuffer quad;
    private int vw, vh, tw, th;

    private static final String VS =
            "attribute vec4 p; varying vec2 uv;"
            + "void main(){ gl_Position = vec4(p.xy, 0.0, 1.0); uv = p.zw; }";
    // Each RGBA texel holds two pixels: U Y0 V Y1. The texture is sampled by hand: luma is
    // bilinear between neighbouring pixels, and four taps spread over the area each screen pixel
    // covers soften the downscale, so the picture no longer looks over-sharpened.
    // A mild barrel correction straightens the fisheye a little, as BYD's own views do.
    private static final String FS =
            "precision highp float; varying vec2 uv; uniform sampler2D t; uniform float w; uniform float h;"
            + " uniform vec2 hlf; uniform vec2 foot;"
            + "const float K = 0.18;"
            + "vec3 px(vec2 p){"
            + "  float x = p.x * w - 0.5; float x0 = floor(x); float fx = x - x0;"
            + "  float y = clamp(floor(p.y * h) + 0.5, 0.5, h - 0.5) / h;"
            + "  float xa = clamp(x0, 0.0, w - 1.0), xb = clamp(x0 + 1.0, 0.0, w - 1.0);"
            + "  vec4 ca = texture2D(t, vec2((floor(xa / 2.0) + 0.5) * 2.0 / w, y));"
            + "  vec4 cb = texture2D(t, vec2((floor(xb / 2.0) + 0.5) * 2.0 / w, y));"
            + "  float ya = mod(xa, 2.0) < 0.5 ? ca.g : ca.a; float yb = mod(xb, 2.0) < 0.5 ? cb.g : cb.a;"
            + "  return vec3(mix(ya, yb, fx), mix(ca.r, cb.r, fx), mix(ca.b, cb.b, fx)); }"
            + "vec3 bil(vec2 p){ float y = p.y * h - 0.5; float y0 = floor(y); float fy = y - y0;"
            + "  return mix(px(vec2(p.x, (y0 + 0.5) / h)), px(vec2(p.x, (y0 + 1.5) / h)), fy); }"
            + "void main(){"
            + "  vec2 d = uv - 0.5; float a = w / h; vec2 q = vec2(d.x * a, d.y); vec2 r = vec2(hlf.x * a, hlf.y);"
            + "  float r2 = dot(q, q) / dot(r, r); vec2 p = 0.5 + d * (1.0 - K * r2);"
            + "  vec3 s = (bil(p + vec2(-foot.x, -foot.y)) + bil(p + vec2(foot.x, -foot.y))"
            + "          + bil(p + vec2(-foot.x, foot.y)) + bil(p + vec2(foot.x, foot.y))) * 0.25;"
            + "  float yy = 1.164 * (s.x - 0.0625); float u = s.y - 0.5, v = s.z - 0.5;"
            + "  gl_FragColor = vec4(yy + 1.596 * v, yy - 0.392 * u - 0.813 * v, yy + 2.017 * u, 1.0); }";

    @Override public void onSurfaceCreated(GL10 gl, EGLConfig cfg) {
        prog = GLES20.glCreateProgram();
        GLES20.glAttachShader(prog, shader(GLES20.GL_VERTEX_SHADER, VS));
        GLES20.glAttachShader(prog, shader(GLES20.GL_FRAGMENT_SHADER, FS));
        GLES20.glLinkProgram(prog);
        aPos = GLES20.glGetAttribLocation(prog, "p");
        uTex = GLES20.glGetUniformLocation(prog, "t");
        uW = GLES20.glGetUniformLocation(prog, "w");
        uH = GLES20.glGetUniformLocation(prog, "h");
        uHalf = GLES20.glGetUniformLocation(prog, "hlf");
        uFoot = GLES20.glGetUniformLocation(prog, "foot");
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
        GLES20.glUniform1f(uH, (float) h);
        GLES20.glUniform2f(uHalf, halfU, halfV);
        // Quarter of the source area one screen pixel covers, in texture units (at least half a pixel).
        float sx = vw == 0 ? 0 : (2 * halfU * w) / vw, sy = vh == 0 ? 0 : (2 * halfV * h) / vh;
        GLES20.glUniform2f(uFoot, Math.max(0.5f, sx) * 0.25f / w, Math.max(0.5f, sy) * 0.25f / h);
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
        halfU = (u1 - u0) / 2; halfV = (v1 - v0) / 2;
        float[] q = { -1, -1, u0, v1,  1, -1, u1, v1,  -1, 1, u0, v0,  1, 1, u1, v0 };
        FloatBuffer f = ByteBuffer.allocateDirect(q.length * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
        f.put(q).position(0);
        return f;
    }
}
