package ru.murmansk.aurora;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Настраивает WebView: страницы приложения открываются с адреса
 * https://appassets.androidplatform.net/ и берутся из assets/web,
 * запросы к /net идут в Net, внешние ссылки открываются в браузере.
 */
final class WebHost {
    static final String HOST = "appassets.androidplatform.net";
    static final String BASE = "https://" + HOST + "/";
    static final int BACKGROUND = 0xFF161B3D;
    private static final String TAG = "AuroraWeb";

    private WebHost() {
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    static void configure(WebView view, Bridge bridge, final Runnable onCrash) {
        final Context app = view.getContext().getApplicationContext();
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        view.setBackgroundColor(BACKGROUND);
        view.addJavascriptInterface(bridge, "AuroraBridge");

        view.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                try {
                    if ("/net".equals(u.getPath())) return Net.proxy(u.getQueryParameter("u"));
                    return Assets.serve(app, u.getPath());
                } catch (RuntimeException e) {
                    Logs.e(TAG, "запрос " + u.getPath(), e);
                    return Assets.notFound();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                String scheme = u.getScheme();
                if ("https".equals(scheme) || "http".equals(scheme)) {
                    try {
                        app.startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    } catch (ActivityNotFoundException e) {
                        Logs.w(TAG, "нет браузера для " + u);
                    }
                }
                return true;
            }

            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
                Logs.w(TAG, "процесс WebView завершился" + (detail.didCrash() ? " со сбоем" : " (нехватка памяти)"));
                if (onCrash != null) onCrash.run();
                return true;
            }
        });

        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                String src = m.sourceId() == null ? "" : m.sourceId().replace(BASE, "");
                String text = "JS " + m.message() + " (" + src + ":" + m.lineNumber() + ")";
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) Logs.e(TAG, text, null);
                else if (m.messageLevel() == ConsoleMessage.MessageLevel.WARNING) Logs.w(TAG, text);
                else Logs.i(TAG, text);
                return true;
            }
        });
    }
}
