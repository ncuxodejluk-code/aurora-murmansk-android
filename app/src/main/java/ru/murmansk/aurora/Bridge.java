package ru.murmansk.aurora;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.lang.ref.WeakReference;

/** Методы, которые страница вызывает через window.AuroraBridge. */
public final class Bridge {
    interface Listener {
        void onWorkerDone(boolean ok);
    }

    private static final String TAG = "AuroraBridge";
    private final Context app;
    private final WeakReference<WebView> view;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());

    Bridge(Context ctx, WebView view, Listener listener) {
        this.app = ctx.getApplicationContext();
        this.view = new WeakReference<>(view);
        this.listener = listener;
    }

    @JavascriptInterface
    public String storageGet(String key) {
        return Store.get(key);
    }

    @JavascriptInterface
    public void storageSet(String key, String json) {
        Store.set(key, json);
    }

    @JavascriptInterface
    public void storageRemove(String key) {
        Store.remove(key);
    }

    @JavascriptInterface
    public String storageKeys() {
        return Store.keysJson();
    }

    @JavascriptInterface
    public void storageChanged(String keysJson) {
        WebHub.broadcast(view.get(), keysJson);
    }

    @JavascriptInterface
    public void showNotification(String id, String title, String text) {
        Notifier.show(app, id, title, text);
    }

    @JavascriptInterface
    public boolean notificationsAllowed() {
        return Notifier.allowed(app);
    }

    @JavascriptInterface
    public void openNotificationSettings() {
        main.post(new Runnable() {
            @Override
            public void run() {
                Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, app.getPackageName())
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    app.startActivity(i);
                } catch (ActivityNotFoundException e) {
                    Logs.w(TAG, "нет экрана настроек уведомлений");
                }
            }
        });
    }

    @JavascriptInterface
    public void updateWidget(String json) {
        Store.set("widget", json);
        AuroraWidget.updateAll(app);
    }

    @JavascriptInterface
    public void log(String message) {
        Logs.i("AuroraJS", message);
    }

    @JavascriptInterface
    public void openLogs() {
        main.post(new Runnable() {
            @Override
            public void run() {
                app.startActivity(new Intent(app, LogActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
        });
    }

    @JavascriptInterface
    public void reschedule() {
        RefreshJob.schedule(app, true);
    }

    @JavascriptInterface
    public void workerDone(final boolean ok) {
        if (listener == null) return;
        main.post(new Runnable() {
            @Override
            public void run() {
                listener.onWorkerDone(ok);
            }
        });
    }

    @JavascriptInterface
    public String appVersion() {
        try {
            return app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "";
        }
    }
}
