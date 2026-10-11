package ru.murmansk.aurora;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Фоновая проверка по расписанию: открывает worker.html в невидимом WebView,
 * та же логика, что и на экране, загружает данные, считает прогноз,
 * обновляет виджет и присылает уведомления.
 */
public class RefreshJob extends JobService {
    static final int JOB_ID = 4201;
    private static final String TAG = "AuroraJob";
    private static final long TIMEOUT_MS = 100_000L;

    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView web;
    private JobParameters params;

    private final Runnable timeout = new Runnable() {
        @Override
        public void run() {
            Logs.w(TAG, "фоновая проверка не уложилась во время");
            finish();
        }
    };

    static void schedule(Context ctx, boolean replace) {
        try {
            JobScheduler js = ctx.getSystemService(JobScheduler.class);
            if (js == null) return;
            long period = Math.max(15, intervalMinutes()) * 60_000L;
            JobInfo existing = js.getPendingJob(JOB_ID);
            if (!replace && existing != null && existing.getIntervalMillis() == period) return;
            JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(ctx, RefreshJob.class))
                    .setPeriodic(period, Math.max(5 * 60_000L, period / 3))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPersisted(true)
                    .build();
            int result = js.schedule(job);
            if (result == JobScheduler.RESULT_SUCCESS) Logs.i(TAG, "фоновая проверка: каждые " + period / 60_000L + " мин");
            else Logs.w(TAG, "расписание не принято системой");
        } catch (RuntimeException e) {
            // Например, SecurityException без нужного разрешения: приложение должно работать и без фона.
            Logs.e(TAG, "не удалось запланировать фоновую проверку", e);
        }
    }

    private static long intervalMinutes() {
        String raw = Store.get("settings");
        if (raw == null) return 15;
        try {
            return new JSONObject(raw).optInt("intervalMin", 15);
        } catch (JSONException e) {
            return 15;
        }
    }

    @Override
    public boolean onStartJob(JobParameters p) {
        Store.init(this);
        Logs.i(TAG, "фоновая проверка началась");
        params = p;
        try {
            web = new WebView(getApplicationContext());
        } catch (RuntimeException e) {
            // Например, системный WebView как раз обновляется.
            Logs.e(TAG, "WebView недоступен", e);
            params = null;
            return false;
        }
        Bridge bridge = new Bridge(this, web, new Bridge.Listener() {
            @Override
            public void onWorkerDone(boolean ok) {
                if (ok) Logs.i(TAG, "фоновая проверка завершена");
                else Logs.w(TAG, "фоновая проверка завершилась с ошибкой");
                finish();
            }
        });
        WebHost.configure(web, bridge, new Runnable() {
            @Override
            public void run() {
                finish();
            }
        });
        WebHub.register(web);
        main.postDelayed(timeout, TIMEOUT_MS);
        web.loadUrl(WebHost.BASE + "worker.html");
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters p) {
        Logs.w(TAG, "система прервала фоновую проверку");
        release();
        params = null;
        return true;
    }

    private void finish() {
        release();
        if (params != null) {
            JobParameters p = params;
            params = null;
            jobFinished(p, false);
        }
    }

    private void release() {
        main.removeCallbacks(timeout);
        if (web != null) {
            WebHub.unregister(web);
            web.stopLoading();
            web.destroy();
            web = null;
        }
    }
}
