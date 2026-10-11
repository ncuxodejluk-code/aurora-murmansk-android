package ru.murmansk.aurora;

import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

/** Сообщает всем открытым страницам, что данные в хранилище изменились. */
final class WebHub {
    private static final Set<WebView> views = new HashSet<>();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final Pattern KEYS = Pattern.compile("\\[[\"A-Za-z0-9_,]*\\]");

    private WebHub() {
    }

    /** Только из главного потока. */
    static void register(WebView v) {
        views.add(v);
    }

    /** Только из главного потока. */
    static void unregister(WebView v) {
        views.remove(v);
    }

    static void broadcast(final WebView origin, final String keysJson) {
        if (keysJson == null || !KEYS.matcher(keysJson).matches()) return;
        main.post(new Runnable() {
            @Override
            public void run() {
                String js = "window.__auroraStorageChanged&&window.__auroraStorageChanged(" + keysJson + ")";
                for (WebView v : new ArrayList<>(views)) {
                    if (v != origin) v.evaluateJavascript(js, null);
                }
            }
        });
    }
}
