package io.gitlab.louiswalder6.p2pcord;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;

/**
 * "Reachable in the background": keeps the process, and with it the P2P
 * backend, alive so messages keep arriving and notifications come from the
 * backend even when the UI was swiped away or after a reboot.
 *
 * It holds no permanent wake lock. While the phone sleeps deeply (Doze) its
 * connections go quiet; an inexact alarm wakes it about every 15 minutes for a
 * short sync (see WakeReceiver), so messages arrive at the latest then.
 */
public final class ConnectionService extends Service {
  static final long WAKE_INTERVAL = 15 * 60 * 1000L;

  static void start(Context context) {
    context.startForegroundService(new Intent(context, ConnectionService.class));
  }

  static void stop(Context context) {
    context.stopService(new Intent(context, ConnectionService.class));
    cancelWake(context);
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification n = new Notification.Builder(this, P2PApp.CHANNEL_BACKGROUND)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle("P2Pcord ist erreichbar")
      .setContentText("Empfängt Nachrichten im Hintergrund – ausblendbar in den App-Benachrichtigungen")
      .setContentIntent(tap)
      .setOngoing(true)
      .setShowWhen(false)
      .build();
    int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING : ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
    try {
      startForeground(3, n, type);
    } catch (RuntimeException e) {
      stopSelf();
      return START_NOT_STICKY;
    }
    ((P2PApp) getApplication()).backend().start();
    scheduleWake(this);
    return START_STICKY;
  }

  static void scheduleWake(Context context) {
    AlarmManager am = context.getSystemService(AlarmManager.class);
    am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + WAKE_INTERVAL, wakeIntent(context));
  }

  private static void cancelWake(Context context) {
    context.getSystemService(AlarmManager.class).cancel(wakeIntent(context));
  }

  private static PendingIntent wakeIntent(Context context) {
    return PendingIntent.getBroadcast(context, 1, new Intent(context, WakeReceiver.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
