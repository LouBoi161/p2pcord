package io.gitlab.louiswalder6.p2pcord;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONObject;

/**
 * System notifications decided by the backend (workers/notifier.js): new
 * messages and incoming DM calls. One notification per chat; tapping it opens
 * that chat.
 */
final class Notifications {
  static final String EXTRA_SPACE = "space";
  static final String EXTRA_CHANNEL = "channel";

  private Notifications() {}

  static void show(Context context, JSONObject n) {
    NotificationManager nm = context.getSystemService(NotificationManager.class);
    String tag = n.optString("tag");
    if ("cancel".equals(n.optString("kind"))) {
      nm.cancel(tag, 0);
      return;
    }
    if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
    boolean call = "call".equals(n.optString("kind"));
    Intent open = new Intent(context, MainActivity.class)
      .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK)
      .putExtra(EXTRA_SPACE, n.optString("space"))
      .putExtra(EXTRA_CHANNEL, n.optString("channel"));
    PendingIntent tap = PendingIntent.getActivity(context, tag.hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification.Builder b = new Notification.Builder(context, call ? P2PApp.CHANNEL_RING : P2PApp.CHANNEL_MESSAGES)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(n.optString("title"))
      .setContentText(n.optString("body"))
      .setContentIntent(tap)
      .setAutoCancel(true)
      .setCategory(call ? Notification.CATEGORY_CALL : Notification.CATEGORY_MESSAGE);
    if (call) b.setTimeoutAfter(60_000);
    nm.notify(tag, 0, b.build());
  }

  // The app is on screen: it shows new messages itself
  static void clearMessages(Context context) {
    for (android.service.notification.StatusBarNotification s : context.getSystemService(NotificationManager.class).getActiveNotifications()) {
      if (s.getTag() != null && s.getId() == 0) context.getSystemService(NotificationManager.class).cancel(s.getTag(), 0);
    }
  }
}
