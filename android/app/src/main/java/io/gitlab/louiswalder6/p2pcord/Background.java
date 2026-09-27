package io.gitlab.louiswalder6.p2pcord;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;

/** The "reachable in the background" switch, remembered for boot. */
final class Background {
  private static final String PREFS = "background";

  private Background() {}

  static boolean enabled(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("on", false);
  }

  static void set(Context context, boolean on) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("on", on).apply();
    if (on) ConnectionService.start(context);
    else ConnectionService.stop(context);
  }

  static boolean batteryExempt(Context context) {
    return context.getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(context.getPackageName());
  }

  // Some manufacturers still stop background apps: ask to exempt P2Pcord
  static void requestBatteryExempt(Context context) {
    Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + context.getPackageName()))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    try {
      context.startActivity(i);
    } catch (RuntimeException e) {
      context.startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
  }
}
