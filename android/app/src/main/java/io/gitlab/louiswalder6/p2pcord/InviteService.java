package io.gitlab.louiswalder6.p2pcord;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

/**
 * Keeps the app reachable in the background while an invite code is open:
 * only the device that created the code can let the friend in, and Android
 * freezes apps soon after the user switches to a messenger to send the code.
 * Started by the page with a duration; stops itself when it runs out.
 */
public final class InviteService extends Service {
  static final String EXTRA_MS = "ms";
  private final Handler main = new Handler(Looper.getMainLooper());
  private final Runnable stop = this::stopSelf;

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    long ms = intent != null ? intent.getLongExtra(EXTRA_MS, 0) : 0;
    Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification n = new Notification.Builder(this, P2PApp.CHANNEL_WAIT)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle("Warte auf deinen Freund…")
      .setContentText("P2Pcord bleibt erreichbar, bis er beigetreten ist")
      .setContentIntent(tap)
      .setOngoing(true)
      .build();
    try {
      startForeground(2, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
    } catch (RuntimeException e) {
      stopSelf();
      return START_NOT_STICKY;
    }
    main.removeCallbacks(stop);
    main.postDelayed(stop, Math.max(1000, Math.min(ms, 15 * 60 * 1000L)));
    return START_NOT_STICKY;
  }

  @Override
  public void onDestroy() {
    main.removeCallbacks(stop);
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
