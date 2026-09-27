package io.gitlab.louiswalder6.p2pcord;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Asks the GitHub API for the latest release (same as the desktop app) and
 * reports it in the UI's UpdateState shape. Installing is up to the user:
 * the link opens the APK download in the browser.
 */
final class Updates {
  private static final String API = "https://api.github.com/repos/LouBoi161/p2pcord/releases/latest";
  private static final String PAGE = "https://github.com/LouBoi161/p2pcord/releases/latest";

  private Updates() {}

  /** Blocking; call off the main thread */
  static JSONObject check(String current, String abi) {
    JSONObject out = new JSONObject();
    try {
      out.put("current", current);
      out.put("mode", "manual");
      HttpURLConnection c = (HttpURLConnection) new URL(API).openConnection();
      c.setConnectTimeout(15000);
      c.setReadTimeout(15000);
      c.setRequestProperty("Accept", "application/vnd.github+json");
      c.setRequestProperty("User-Agent", "P2Pcord/" + current);
      if (c.getResponseCode() != 200) throw new IllegalStateException("GitHub antwortet mit " + c.getResponseCode());
      JSONObject rel;
      try (InputStream in = c.getInputStream()) {
        rel = new JSONObject(readAll(in));
      }
      String latest = rel.optString("tag_name", "").replaceFirst("^v", "");
      out.put("latest", latest);
      if (!newer(latest, current)) {
        out.put("status", "current");
        return out;
      }
      String url = rel.optString("html_url", PAGE);
      JSONArray assets = rel.optJSONArray("assets");
      for (int i = 0; assets != null && i < assets.length(); i++) {
        JSONObject a = assets.getJSONObject(i);
        String name = a.optString("name", "");
        if (name.endsWith(".apk") && name.contains(abi)) url = a.optString("browser_download_url", url);
      }
      out.put("status", "available");
      out.put("url", url);
    } catch (Exception e) {
      try {
        out.put("status", "error");
        out.put("error", "Update-Prüfung fehlgeschlagen: " + e.getMessage());
        out.put("quiet", true);
      } catch (Exception ignored) {
      }
    }
    return out;
  }

  static boolean newer(String candidate, String current) {
    int[] a = parse(candidate);
    int[] b = parse(current);
    if (a == null || b == null) return false;
    for (int i = 0; i < 3; i++) if (a[i] != b[i]) return a[i] > b[i];
    return false;
  }

  private static int[] parse(String v) {
    String[] p = v.split("\\.");
    if (p.length != 3) return null;
    try {
      return new int[] { Integer.parseInt(p[0]), Integer.parseInt(p[1]), Integer.parseInt(p[2]) };
    } catch (NumberFormatException e) {
      return null;
    }
  }

  private static String readAll(InputStream in) throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buf = new byte[16384];
    int n;
    while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
    return out.toString(StandardCharsets.UTF_8.name());
  }
}
