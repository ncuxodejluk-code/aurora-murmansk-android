package ru.murmansk.aurora;

import android.net.Uri;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Загружает данные NOAA, NASA и Open-Meteo по просьбе страницы.
 * Запросы идут из приложения, поэтому браузерные ограничения CORS не мешают.
 * Разрешены только три сайта-источника.
 */
final class Net {
    private static final String TAG = "AuroraNet";
    private static final Set<String> ALLOWED = new HashSet<>(Arrays.asList(
            "services.swpc.noaa.gov", "ccmc.gsfc.nasa.gov", "api.open-meteo.com"));

    private Net() {
    }

    static WebResourceResponse proxy(String target) {
        if (target == null) return error(400, "Bad Request", null);
        Uri u = Uri.parse(target);
        if (!"https".equals(u.getScheme()) || !ALLOWED.contains(u.getHost())) {
            return error(403, "Forbidden", null);
        }
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(target).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(22000);
            c.setUseCaches(false);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", "AuroraMurmansk/1.0 (Android)");
            int code = c.getResponseCode();
            if (code != 200) Logs.w(TAG, u.getHost() + u.getPath() + " → " + code);
            InputStream body = code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (body == null) body = new ByteArrayInputStream(new byte[0]);
            if (code < 200 || (code >= 300 && code < 400) || code > 599) code = 502;
            String reason = c.getResponseMessage();
            if (reason == null || reason.trim().isEmpty()) reason = code < 400 ? "OK" : "Error";
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse("application/json", "utf-8", code, reason, headers, body);
        } catch (IOException e) {
            Logs.w(TAG, "нет связи: " + u.getHost() + u.getPath() + " — " + e);
            if (c != null) c.disconnect();
            return error(502, "Bad Gateway", "network");
        }
    }

    private static WebResourceResponse error(int code, String reason, String mark) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        if (mark != null) headers.put("X-Aurora-Error", mark);
        InputStream body = new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8));
        return new WebResourceResponse("text/plain", "utf-8", code, reason, headers, body);
    }
}
