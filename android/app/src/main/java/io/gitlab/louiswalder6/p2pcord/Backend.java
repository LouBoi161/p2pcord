package io.gitlab.louiswalder6.p2pcord;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;

import org.json.JSONException;
import org.json.JSONObject;

import to.holepunch.bare.kit.IPC;
import to.holepunch.bare.kit.Worklet;

/**
 * The P2P backend (workers/mobile.js, bundled as assets/backend.bundle) in a
 * Bare Kit worklet. It lives as long as the process, independent of the
 * activity, and speaks the same length-prefixed JSON frames as on the desktop
 * (framed-stream: 32-bit little-endian length, then the payload).
 * All methods run on the main thread.
 */
final class Backend {
  interface Listener {
    void onFrame(String frame);

    void onExit();
  }

  private static final String TAG = "P2Pcord";

  private final Context context;
  private final Handler main = new Handler(Looper.getMainLooper());
  private Worklet worklet;
  private IPC ipc;
  private Listener listener;
  private boolean exited = false;

  // frames that arrived before the page was listening
  private final List<String> early = new ArrayList<>();

  private ByteBuffer pending = ByteBuffer.allocate(64 * 1024).order(ByteOrder.LITTLE_ENDIAN);
  private final ArrayDeque<ByteBuffer> writes = new ArrayDeque<>();
  private boolean writing = false;

  Backend(Context context) {
    this.context = context.getApplicationContext();
  }

  boolean started() {
    return worklet != null;
  }

  void start() {
    if (worklet != null) return;
    try {
      worklet = new Worklet(null);
      worklet.start("/backend.bundle", readAsset("backend.bundle"), new String[] { context.getFilesDir().getAbsolutePath() });
      ipc = new IPC(worklet);
    } catch (IOException e) {
      Log.e(TAG, "backend bundle missing", e);
      exited = true;
      return;
    }
    read();
    send(VaultKey.frame(context));
  }

  void setListener(Listener l) {
    listener = l;
    if (l == null) return;
    for (String f : early) l.onFrame(f);
    early.clear();
    if (exited) l.onExit();
  }

  private ByteBuffer readAsset(String name) throws IOException {
    try (InputStream in = context.getAssets().open(name)) {
      ByteArrayOutputStream out = new ByteArrayOutputStream(4 * 1024 * 1024);
      byte[] buf = new byte[64 * 1024];
      int n;
      while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
      byte[] bytes = out.toByteArray();
      ByteBuffer direct = ByteBuffer.allocateDirect(bytes.length);
      direct.put(bytes);
      direct.flip();
      return direct;
    }
  }

  private void read() {
    ipc.read((data, err) -> {
      if (data == null) {
        Log.w(TAG, "backend exited");
        exited = true;
        if (listener != null) listener.onExit();
        return;
      }
      feed(data);
      read();
    });
  }

  private void feed(ByteBuffer data) {
    if (pending.remaining() < data.remaining()) {
      ByteBuffer bigger = ByteBuffer.allocate(Math.max(pending.capacity() * 2, pending.position() + data.remaining())).order(ByteOrder.LITTLE_ENDIAN);
      pending.flip();
      bigger.put(pending);
      pending = bigger;
    }
    pending.put(data);
    pending.flip();
    while (pending.remaining() >= 4) {
      int len = pending.getInt(pending.position());
      if (len < 0 || pending.remaining() < 4 + len) break;
      pending.position(pending.position() + 4);
      byte[] frame = new byte[len];
      pending.get(frame);
      deliver(new String(frame, StandardCharsets.UTF_8));
    }
    pending.compact();
  }

  private void deliver(String frame) {
    if (listener != null) listener.onFrame(frame);
    else early.add(frame);
  }

  void send(String frame) {
    if (ipc == null || exited) return;
    byte[] bytes = frame.getBytes(StandardCharsets.UTF_8);
    ByteBuffer buf = ByteBuffer.allocateDirect(4 + bytes.length).order(ByteOrder.LITTLE_ENDIAN);
    buf.putInt(bytes.length);
    buf.put(bytes);
    buf.flip();
    writes.add(buf);
    flush();
  }

  // IPC keeps one pending write at a time: queue the rest
  private void flush() {
    if (writing || writes.isEmpty()) return;
    writing = true;
    ipc.write(writes.poll(), err -> {
      writing = false;
      if (err != null) Log.e(TAG, "ipc write", err);
      main.post(this::flush);
    });
  }

  static String json(String key, Object value) {
    try {
      return new JSONObject().put(key, value).toString();
    } catch (JSONException e) {
      return "{}";
    }
  }
}
