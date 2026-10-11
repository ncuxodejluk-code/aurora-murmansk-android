package ru.murmansk.aurora;

import android.content.Context;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/** Отдаёт страницы интерфейса из папки assets/web с правильными типами файлов. */
final class Assets {
    private Assets() {
    }

    static WebResourceResponse serve(Context ctx, String path) {
        if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
        if (path.contains("..") || path.contains("\\")) return notFound();
        try {
            InputStream in = ctx.getAssets().open("web" + path);
            String mime = mime(path);
            boolean text = mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("svg+xml");
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            return new WebResourceResponse(mime, text ? "utf-8" : null, 200, "OK", headers, in);
        } catch (IOException e) {
            return notFound();
        }
    }

    static WebResourceResponse notFound() {
        Map<String, String> headers = new HashMap<>();
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers,
                new ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }
}
