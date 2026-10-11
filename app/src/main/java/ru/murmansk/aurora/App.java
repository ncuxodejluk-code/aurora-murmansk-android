package ru.murmansk.aurora;

import android.app.Application;

/** Запуск приложения: хранилище, канал уведомлений и расписание фоновой проверки. */
public class App extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        Store.init(this);
        Notifier.createChannel(this);
        RefreshJob.schedule(this, false);
    }
}
