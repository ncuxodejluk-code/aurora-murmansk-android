package ru.murmansk.aurora;

import android.app.Application;
import android.os.Build;

/** Запуск приложения: хранилище, канал уведомлений и расписание фоновой проверки. */
public class App extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        // Журнал — первым: если дальше что-то упадёт, сбой будет записан.
        Logs.init(this);
        Logs.i("AuroraApp", "запуск процесса, Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
        try {
            Store.init(this);
        } catch (RuntimeException e) {
            Logs.e("AuroraApp", "хранилище", e);
        }
        try {
            Notifier.createChannel(this);
        } catch (RuntimeException e) {
            Logs.e("AuroraApp", "канал уведомлений", e);
        }
        RefreshJob.schedule(this, false);
    }
}
