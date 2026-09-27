package io.gitlab.louiswalder6.p2pcord;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps the process (and with it the WebView's WebRTC call) alive while the
 * app is in the background during a call. Started and stopped by the page.
 */
public final class CallService extends Service {
  private PowerManager.WakeLock lock;

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification n = new Notification.Builder(this, P2PApp.CHANNEL_CALL)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle("Im Sprachkanal")
      .setContentText("Tippen, um zu P2Pcord zurückzukehren")
      .setContentIntent(tap)
      .setOngoing(true)
      .setCategory(Notification.CATEGORY_CALL)
      .build();
    try {
      startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
    } catch (RuntimeException e) {
      // no microphone permission (yet): the call still runs while the app is visible
      stopSelf();
      return START_NOT_STICKY;
    }
    if (lock == null) {
      lock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "p2pcord:call");
      lock.acquire(6 * 60 * 60 * 1000L);
    }
    return START_NOT_STICKY;
  }

  @Override
  public void onDestroy() {
    if (lock != null && lock.isHeld()) lock.release();
    lock = null;
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
