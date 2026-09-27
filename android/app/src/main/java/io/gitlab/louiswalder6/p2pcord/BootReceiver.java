package io.gitlab.louiswalder6.p2pcord;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Starts the background connection after a reboot or an app update, if it is on. */
public final class BootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    String a = intent.getAction();
    if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) return;
    if (Background.enabled(context)) ConnectionService.start(context);
  }
}
