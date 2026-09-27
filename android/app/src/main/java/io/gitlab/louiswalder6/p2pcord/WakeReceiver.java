package io.gitlab.louiswalder6.p2pcord;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;

/** Briefly keeps the CPU awake so the backend can reconnect and sync, then sleeps again. */
public final class WakeReceiver extends BroadcastReceiver {
  private static final long SYNC_TIME = 30_000;

  @Override
  public void onReceive(Context context, Intent intent) {
    if (!Background.enabled(context)) return;
    PowerManager.WakeLock lock = context.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "p2pcord:sync");
    lock.acquire(SYNC_TIME);
    ((P2PApp) context.getApplicationContext()).backend().start();
    ConnectionService.scheduleWake(context);
  }
}
