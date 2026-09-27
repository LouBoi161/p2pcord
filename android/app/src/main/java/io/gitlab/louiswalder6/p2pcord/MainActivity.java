package io.gitlab.louiswalder6.p2pcord;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Hosts the P2Pcord UI (the same Svelte build as the desktop, in assets/ui/) in
 * a WebView and relays between it and the backend worklet. The page is served
 * from https://appassets.androidplatform.net/ui/ (a secure origin, needed for
 * the microphone); downloaded attachments from /p2pfile/. The page talks to
 * this activity only through the P2PNative message listener, restricted to
 * that origin and the main frame (see renderer/src/lib/bridges/android.ts).
 */
public final class MainActivity extends Activity implements Backend.Listener {
  private static final String TAG = "P2Pcord";
  private static final String HOST = "appassets.androidplatform.net";
  private static final String ORIGIN = "https://" + HOST;
  private static final int REQ_MEDIA = 1;
  private static final int REQ_FILES = 2;
  private static final int REQ_NOTIFY = 3;

  private WebView web;
  private JavaScriptReplyProxy reply;
  private Backend backend;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private PermissionRequest pendingMedia;
  private ValueCallback<Uri[]> pendingFiles;
  private boolean callActive = false;
  private int notifyId = 100;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    backend = ((P2PApp) getApplication()).backend();

    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
    web = new WebView(this);
    web.setBackgroundColor(0xff1e1f22);
    FrameLayout frame = new FrameLayout(this);
    frame.setBackgroundColor(0xff1e1f22);
    frame.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    setContentView(frame);
    applyInsets(frame);

    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setAllowFileAccess(false);
    s.setAllowContentAccess(false);
    s.setSupportMultipleWindows(false);
    s.setJavaScriptCanOpenWindowsAutomatically(false);
    s.setTextZoom(100);

    web.setWebViewClient(new Client());
    web.setWebChromeClient(new Chrome());

    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      Toast.makeText(this, "Bitte aktualisiere Android System WebView.", Toast.LENGTH_LONG).show();
    } else {
      WebViewCompat.addWebMessageListener(web, "P2PNative", Collections.singleton(ORIGIN), this::onPageMessage);
    }

    if (Build.VERSION.SDK_INT >= 33) {
      getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::onBack);
      if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFY);
      }
    }

    backend.setListener(this);
    backend.start();
    if (Background.enabled(this)) ConnectionService.start(this);
    openFrom(getIntent());

    String query = "?platform=android&version=" + Uri.encode(BuildConfig.VERSION_NAME) + (BuildConfig.DEBUG ? "&debug=1" : "");
    web.loadUrl(ORIGIN + "/ui/index.html" + query);
  }

  // Edge-to-edge (Android 15+): keep the page clear of status bar, navigation bar and keyboard
  private void applyInsets(View container) {
    container.setOnApplyWindowInsetsListener((View v, WindowInsets insets) -> {
      int l, t, r, b;
      if (Build.VERSION.SDK_INT >= 30) {
        android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
        l = i.left;
        t = i.top;
        r = i.right;
        b = i.bottom;
      } else {
        l = insets.getSystemWindowInsetLeft();
        t = insets.getSystemWindowInsetTop();
        r = insets.getSystemWindowInsetRight();
        b = insets.getSystemWindowInsetBottom();
      }
      v.setPadding(l, t, r, b);
      return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
    });
  }

  @Override
  protected void onDestroy() {
    backend.setListener(null);
    reply = null;
    web.destroy();
    super.onDestroy();
  }

  // In the background the backend takes over notifications. Without a call the
  // page is paused to save battery; during a call it keeps running (the call
  // lives in the WebView).
  @Override
  protected void onStart() {
    super.onStart();
    web.onResume();
    web.resumeTimers();
    backend.setVisible(true);
    Notifications.clearMessages(this);
  }

  @Override
  protected void onStop() {
    backend.setVisible(false);
    if (!callActive) {
      web.onPause();
      web.pauseTimers();
    }
    super.onStop();
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    openFrom(intent);
  }

  // A tapped notification opens its chat
  private void openFrom(Intent intent) {
    if (intent == null) return;
    String space = intent.getStringExtra(Notifications.EXTRA_SPACE);
    if (space == null || space.isEmpty()) return;
    post(obj("t", "open", "space", space, "channel", intent.getStringExtra(Notifications.EXTRA_CHANNEL)));
    intent.removeExtra(Notifications.EXTRA_SPACE);
  }

  @SuppressWarnings("deprecation")
  @Override
  public void onBackPressed() {
    onBack();
  }

  private void onBack() {
    if (reply != null) post(obj("t", "back"));
    else moveTaskToBack(true);
  }

  // ---- backend -> page ----

  @Override
  public void onFrame(String frame) {
    post(obj("t", "frame", "d", frame));
  }

  @Override
  public void onExit() {
    post(obj("t", "exit", "code", 1));
  }

  // until the page has said something, messages wait here
  private final List<JSONObject> outbox = new ArrayList<>();

  private void post(JSONObject msg) {
    if (reply == null) {
      if (outbox.size() < 10000) outbox.add(msg);
      return;
    }
    try {
      reply.postMessage(msg.toString());
    } catch (RuntimeException e) {
      Log.w(TAG, "postMessage", e);
    }
  }

  // ---- page -> app ----

  private void onPageMessage(WebView view, WebMessageCompat message, Uri origin, boolean isMainFrame, JavaScriptReplyProxy proxy) {
    if (!isMainFrame || !ORIGIN.equals(origin.toString().replaceAll("/$", ""))) return;
    boolean first = reply != proxy;
    reply = proxy;
    if (first && !outbox.isEmpty()) {
      List<JSONObject> queued = new ArrayList<>(outbox);
      outbox.clear();
      for (JSONObject q : queued) post(q);
    }
    String data = message.getData();
    if (data == null) return;
    JSONObject m;
    try {
      m = new JSONObject(data);
    } catch (JSONException e) {
      return;
    }
    String t = m.optString("t");
    if ("send".equals(t)) {
      backend.send(m.optString("d"));
    } else if ("req".equals(t)) {
      handle(m.optInt("id"), m.optString("m"), m.optJSONArray("a"));
    }
  }

  private void handle(int id, String method, JSONArray args) {
    if (args == null) args = new JSONArray();
    try {
      switch (method) {
        case "start":
          backend.start();
          respond(id, true);
          break;
        case "clipboard":
          ClipboardManager cm = getSystemService(ClipboardManager.class);
          cm.setPrimaryClip(ClipData.newPlainText("P2Pcord", args.optString(0)));
          respond(id, null);
          break;
        case "open":
          respond(id, openExternal(args.optString(0)));
          break;
        case "save":
          saveFile(id, args.optString(0), args.optString(1));
          break;
        case "notify":
          notify(args.optString(0), args.optString(1));
          respond(id, null);
          break;
        case "call":
          setCallActive(args.optBoolean(0));
          respond(id, null);
          break;
        case "awake":
          keepAwake(args.optLong(0));
          respond(id, null);
          break;
        case "background":
          if (args.length() > 0) Background.set(this, args.optBoolean(0));
          respond(id, obj("on", Background.enabled(this), "battery", Background.batteryExempt(this)));
          break;
        case "battery":
          Background.requestBatteryExempt(this);
          respond(id, null);
          break;
        case "exit":
          moveTaskToBack(true);
          respond(id, null);
          break;
        case "updateState":
          // the page asks once on start: answer now, report a new version when the check is done
          respond(id, obj("status", "idle"));
          io.execute(() -> {
            JSONObject res = Updates.check(BuildConfig.VERSION_NAME, Build.SUPPORTED_ABIS[0]);
            if ("available".equals(res.optString("status"))) main.post(() -> post(obj("t", "update", "s", res)));
          });
          break;
        case "checkUpdates":
          io.execute(() -> {
            JSONObject res = Updates.check(BuildConfig.VERSION_NAME, Build.SUPPORTED_ABIS[0]);
            main.post(() -> respond(id, res));
          });
          break;
        default:
          fail(id, "UNKNOWN_METHOD");
      }
    } catch (RuntimeException e) {
      fail(id, e.getMessage() != null ? e.getMessage() : e.toString());
    }
  }

  private void respond(int id, Object result) {
    JSONObject m = obj("t", "res", "id", id);
    try {
      m.put("r", result == null ? JSONObject.NULL : result);
    } catch (JSONException ignored) {
    }
    post(m);
  }

  private void fail(int id, String error) {
    post(obj("t", "res", "id", id, "e", error));
  }

  private boolean openExternal(String url) {
    Uri u = Uri.parse(url);
    String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
    if (!scheme.equals("https") && !scheme.equals("http")) return false;
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      return true;
    } catch (RuntimeException e) {
      return false;
    }
  }

  private void setCallActive(boolean active) {
    if (active == callActive) return;
    callActive = active;
    Intent i = new Intent(this, CallService.class);
    if (active) {
      if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startForegroundService(i);
    } else {
      stopService(i);
    }
  }

  // ms > 0: stay reachable that long (an open invite); 0: no longer needed
  private void keepAwake(long ms) {
    Intent i = new Intent(this, InviteService.class);
    if (ms > 0) startForegroundService(i.putExtra(InviteService.EXTRA_MS, ms));
    else stopService(i);
  }

  private void notify(String title, String body) {
    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
    Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification n = new Notification.Builder(this, P2PApp.CHANNEL_MESSAGES)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(title)
      .setContentText(body)
      .setContentIntent(tap)
      .setAutoCancel(true)
      .setCategory(Notification.CATEGORY_MESSAGE)
      .build();
    getSystemService(NotificationManager.class).notify(notifyId++, n);
  }

  // Attachments live in a cache that is wiped on every start: saving copies one to Downloads/P2Pcord
  private void saveFile(int id, String rel, String name) {
    File file = cached(rel);
    if (file == null || !file.isFile()) {
      fail(id, "NOT_FOUND");
      return;
    }
    String safe = new File(name.isEmpty() ? file.getName() : name).getName().replaceAll("[\\\\/:*?\"<>|]+", "_");
    io.execute(() -> {
      boolean ok = false;
      try {
        ContentValues v = new ContentValues();
        v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
        v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/P2Pcord");
        v.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
        if (uri != null) {
          try (InputStream in = new FileInputStream(file); OutputStream out = getContentResolver().openOutputStream(uri)) {
            byte[] buf = new byte[256 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
          }
          v.clear();
          v.put(MediaStore.Downloads.IS_PENDING, 0);
          getContentResolver().update(uri, v, null, null);
          ok = true;
        }
      } catch (IOException | RuntimeException e) {
        Log.e(TAG, "save", e);
      }
      boolean saved = ok;
      main.post(() -> {
        Toast.makeText(this, saved ? "In Downloads/P2Pcord gespeichert" : "Speichern fehlgeschlagen", Toast.LENGTH_SHORT).show();
        respond(id, saved);
      });
    });
  }

  private File cached(String rel) {
    try {
      File root = new File(getFilesDir(), "p2pcord/files").getCanonicalFile();
      File file = new File(root, rel).getCanonicalFile();
      if (!file.getPath().startsWith(root.getPath() + File.separator)) return null;
      return file;
    } catch (IOException e) {
      return null;
    }
  }

  // ---- permissions and file picker ----

  @Override
  public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
    if (code != REQ_MEDIA || pendingMedia == null) return;
    PermissionRequest req = pendingMedia;
    pendingMedia = null;
    grantMedia(req);
  }

  private void grantMedia(PermissionRequest req) {
    List<String> grant = new ArrayList<>();
    for (String r : req.getResources()) {
      if (r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) grant.add(r);
      if (r.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE) && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) grant.add(r);
    }
    if (grant.isEmpty()) req.deny();
    else req.grant(grant.toArray(new String[0]));
    // a call that started before the microphone was allowed gets its service now
    if (callActive && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
      startForegroundService(new Intent(this, CallService.class));
    }
  }

  @Override
  protected void onActivityResult(int code, int result, Intent data) {
    if (code != REQ_FILES || pendingFiles == null) {
      super.onActivityResult(code, result, data);
      return;
    }
    ValueCallback<Uri[]> cb = pendingFiles;
    pendingFiles = null;
    Uri[] uris = null;
    if (result == RESULT_OK && data != null) {
      if (data.getClipData() != null) {
        ClipData clip = data.getClipData();
        uris = new Uri[clip.getItemCount()];
        for (int i = 0; i < uris.length; i++) uris[i] = clip.getItemAt(i).getUri();
      } else if (data.getData() != null) {
        uris = new Uri[] { data.getData() };
      }
    }
    cb.onReceiveValue(uris);
  }

  private final class Chrome extends WebChromeClient {
    @Override
    public void onPermissionRequest(PermissionRequest req) {
      if (!ORIGIN.equals(req.getOrigin().toString().replaceAll("/$", ""))) {
        req.deny();
        return;
      }
      List<String> ask = new ArrayList<>();
      for (String r : req.getResources()) {
        if (r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) ask.add(Manifest.permission.RECORD_AUDIO);
        if (r.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE) && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) ask.add(Manifest.permission.CAMERA);
      }
      if (ask.isEmpty()) {
        grantMedia(req);
        return;
      }
      if (pendingMedia != null) pendingMedia.deny();
      pendingMedia = req;
      requestPermissions(ask.toArray(new String[0]), REQ_MEDIA);
    }

    @Override
    public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
      if (pendingFiles != null) pendingFiles.onReceiveValue(null);
      pendingFiles = callback;
      Intent i = params.createIntent();
      i.addCategory(Intent.CATEGORY_OPENABLE);
      if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
      try {
        startActivityForResult(i, REQ_FILES);
      } catch (RuntimeException e) {
        pendingFiles = null;
        return false;
      }
      return true;
    }

    // no grey play button over videos that are still loading
    @Override
    public Bitmap getDefaultVideoPoster() {
      return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
    }

    @Override
    public boolean onConsoleMessage(ConsoleMessage m) {
      if (BuildConfig.DEBUG) Log.d(TAG, "[ui] " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
      return true;
    }
  }

  // ---- serving the UI and attachments ----

  private final class Client extends WebViewClient {
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
      Uri u = req.getUrl();
      if (HOST.equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith("/ui/")) return false;
      // links only open after the confirmation dialog, via openExternal
      return true;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
      Uri u = req.getUrl();
      if (!HOST.equals(u.getHost()) || !"https".equals(u.getScheme())) return null;
      String path = u.getPath() == null ? "/" : u.getPath();
      try {
        if (path.startsWith("/ui/")) return asset(path.substring(4));
        if (path.startsWith("/p2pfile/")) return attachment(path.substring(9), req.getRequestHeaders());
      } catch (IOException e) {
        return status(404);
      }
      return status(404);
    }

    @Override
    public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
      // the renderer crashed or was killed for memory: start over with a fresh page
      Log.e(TAG, "renderer gone, crashed=" + detail.didCrash());
      reply = null;
      recreate();
      return true;
    }
  }

  private WebResourceResponse asset(String rel) throws IOException {
    if (rel.isEmpty()) rel = "index.html";
    if (rel.contains("..")) return status(403);
    InputStream in = getAssets().open("ui/" + rel);
    Map<String, String> headers = new HashMap<>();
    headers.put("Cache-Control", "no-cache");
    return new WebResourceResponse(mime(rel), null, 200, "OK", headers, in);
  }

  // Downloaded attachments: never rendered as documents (same rules as on the desktop)
  private WebResourceResponse attachment(String rel, Map<String, String> reqHeaders) throws IOException {
    File file = cached(Uri.decode(rel));
    if (file == null || !file.isFile()) return status(404);
    String type = mime(file.getName());
    if (type.matches("(?i).*(html|xml|svg|javascript).*")) type = "application/octet-stream";
    long size = file.length();
    long start = 0;
    long end = size - 1;
    boolean partial = false;
    String range = null;
    for (Map.Entry<String, String> e : reqHeaders.entrySet()) if (e.getKey().equalsIgnoreCase("Range")) range = e.getValue();
    if (range != null && range.startsWith("bytes=")) {
      String[] p = range.substring(6).split("-", 2);
      try {
        if (!p[0].isEmpty()) start = Long.parseLong(p[0]);
        if (p.length > 1 && !p[1].isEmpty()) end = Math.min(end, Long.parseLong(p[1]));
        else if (p[0].isEmpty() && p.length > 1) start = Math.max(0, size - Long.parseLong(p[1]));
        partial = true;
      } catch (NumberFormatException ignored) {
      }
    }
    if (start > end || start >= size) {
      Map<String, String> h = new HashMap<>();
      h.put("Content-Range", "bytes */" + size);
      return new WebResourceResponse(type, null, 416, "Range Not Satisfiable", h, null);
    }
    FileInputStream in = new FileInputStream(file);
    if (start > 0) in.skip(start);
    long length = end - start + 1;
    Map<String, String> h = new HashMap<>();
    h.put("X-Content-Type-Options", "nosniff");
    h.put("Content-Security-Policy", "default-src 'none'; sandbox");
    h.put("Accept-Ranges", "bytes");
    h.put("Content-Length", String.valueOf(length));
    if (partial) h.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
    return new WebResourceResponse(type, null, partial ? 206 : 200, partial ? "Partial Content" : "OK", h, new Limited(in, length));
  }

  private static WebResourceResponse status(int code) {
    return new WebResourceResponse("text/plain", "utf-8", code, code == 403 ? "Forbidden" : "Not Found", new HashMap<>(), null);
  }

  private static String mime(String name) {
    String n = name.toLowerCase(Locale.ROOT);
    int dot = n.lastIndexOf('.');
    String ext = dot == -1 ? "" : n.substring(dot + 1);
    switch (ext) {
      case "html": return "text/html";
      case "js": case "mjs": return "text/javascript";
      case "css": return "text/css";
      case "wasm": return "application/wasm";
      case "json": case "webmanifest": return "application/json";
      case "png": return "image/png";
      case "jpg": case "jpeg": return "image/jpeg";
      case "gif": return "image/gif";
      case "webp": return "image/webp";
      case "avif": return "image/avif";
      case "svg": return "image/svg+xml";
      case "mp4": case "m4v": return "video/mp4";
      case "webm": return "video/webm";
      case "mov": return "video/quicktime";
      case "mkv": return "video/x-matroska";
      case "mp3": return "audio/mpeg";
      case "ogg": case "opus": return "audio/ogg";
      case "wav": return "audio/wav";
      case "flac": return "audio/flac";
      case "m4a": return "audio/mp4";
      case "gz": return "application/gzip";
      case "txt": return "text/plain";
      case "pdf": return "application/pdf";
      default: return "application/octet-stream";
    }
  }

  /** An input stream that ends after n bytes (for range responses) */
  private static final class Limited extends InputStream {
    private final InputStream in;
    private long left;

    Limited(InputStream in, long n) {
      this.in = in;
      this.left = n;
    }

    @Override
    public int read() throws IOException {
      if (left <= 0) return -1;
      int b = in.read();
      if (b != -1) left--;
      return b;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
      if (left <= 0) return -1;
      int n = in.read(b, off, (int) Math.min(len, left));
      if (n > 0) left -= n;
      return n;
    }

    @Override
    public void close() throws IOException {
      in.close();
    }
  }

  // ---- small helpers ----

  private static JSONObject obj(Object... kv) {
    JSONObject o = new JSONObject();
    try {
      for (int i = 0; i + 1 < kv.length; i += 2) o.put((String) kv[i], kv[i + 1]);
    } catch (JSONException ignored) {
    }
    return o;
  }
}
