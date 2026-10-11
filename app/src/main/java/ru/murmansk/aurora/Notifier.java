package ru.murmansk.aurora;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

/** Уведомления о вспышках, выбросах и шансах увидеть сияние. */
final class Notifier {
    static final String CHANNEL = "aurora";
    private static final int ACCENT = 0xFF5BE3A3;

    private Notifier() {
    }

    static void createChannel(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL, ctx.getString(R.string.channel_name), NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription(ctx.getString(R.string.channel_description));
        ch.enableLights(true);
        ch.setLightColor(ACCENT);
        nm.createNotificationChannel(ch);
    }

    static boolean allowed(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        return nm != null && nm.areNotificationsEnabled();
    }

    static void show(Context ctx, String id, String title, String text) {
        try {
            post(ctx, id, title, text);
        } catch (RuntimeException e) {
            Logs.e("AuroraNotify", "уведомление не показано", e);
        }
    }

    private static void post(Context ctx, String id, String title, String text) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || !nm.areNotificationsEnabled()) {
            Logs.w("AuroraNotify", "уведомления выключены в системе: " + title);
            return;
        }
        Intent open = new Intent(ctx, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(ACCENT)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setShowWhen(true)
                .build();
        nm.notify(id == null ? 0 : id.hashCode(), n);
        Logs.i("AuroraNotify", "уведомление: " + title);
    }
}
