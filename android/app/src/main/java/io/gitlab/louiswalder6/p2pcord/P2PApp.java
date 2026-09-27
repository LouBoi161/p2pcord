package io.gitlab.louiswalder6.p2pcord;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;

public final class P2PApp extends Application {
  static final String CHANNEL_MESSAGES = "messages";
  static final String CHANNEL_CALL = "call";
  static final String CHANNEL_WAIT = "invite";

  private Backend backend;

  @Override
  public void onCreate() {
    super.onCreate();
    NotificationManager nm = getSystemService(NotificationManager.class);
    nm.createNotificationChannel(new NotificationChannel(CHANNEL_MESSAGES, "Nachrichten", NotificationManager.IMPORTANCE_HIGH));
    NotificationChannel call = new NotificationChannel(CHANNEL_CALL, "Laufender Anruf", NotificationManager.IMPORTANCE_LOW);
    call.setShowBadge(false);
    nm.createNotificationChannel(call);
    NotificationChannel wait = new NotificationChannel(CHANNEL_WAIT, "Offene Einladung", NotificationManager.IMPORTANCE_LOW);
    wait.setShowBadge(false);
    nm.createNotificationChannel(wait);
  }

  /** The backend runs once per process and outlives activities */
  Backend backend() {
    if (backend == null) backend = new Backend(this);
    return backend;
  }
}
