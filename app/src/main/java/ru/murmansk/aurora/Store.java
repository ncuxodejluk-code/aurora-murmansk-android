package ru.murmansk.aurora;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Простое хранилище «ключ → JSON» в файлах приложения.
 * Общее для экрана, фоновой проверки и виджета; заменяет chrome.storage.local.
 */
final class Store {
    private static final String TAG = "AuroraStore";
    private static final Pattern KEY = Pattern.compile("[A-Za-z0-9_]{1,40}");
    private static final Map<String, String> cache = new HashMap<>();
    private static File dir;

    private Store() {
    }

    static synchronized void init(Context ctx) {
        if (dir != null) return;
        dir = new File(ctx.getApplicationContext().getFilesDir(), "store");
        if (!dir.exists() && !dir.mkdirs()) Log.w(TAG, "не удалось создать " + dir);
    }

    static synchronized String get(String key) {
        if (!valid(key)) return null;
        if (cache.containsKey(key)) return cache.get(key);
        File f = file(key);
        String value = f.exists() ? read(f) : null;
        cache.put(key, value);
        return value;
    }

    static synchronized void set(String key, String json) {
        if (!valid(key) || json == null) return;
        cache.put(key, json);
        File tmp = new File(dir, key + ".json.tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (IOException e) {
            Log.w(TAG, "запись " + key, e);
            return;
        }
        File target = file(key);
        if (!tmp.renameTo(target)) {
            if (target.exists() && !target.delete()) Log.w(TAG, "не удалось заменить " + key);
            if (!tmp.renameTo(target)) Log.w(TAG, "не удалось сохранить " + key);
        }
    }

    static synchronized void remove(String key) {
        if (!valid(key)) return;
        cache.put(key, null);
        File f = file(key);
        if (f.exists() && !f.delete()) Log.w(TAG, "не удалось удалить " + key);
    }

    static synchronized String keysJson() {
        JSONArray out = new JSONArray();
        File[] files = dir == null ? null : dir.listFiles();
        if (files != null) {
            for (File f : files) {
                String name = f.getName();
                if (name.endsWith(".json")) out.put(name.substring(0, name.length() - 5));
            }
        }
        return out.toString();
    }

    private static boolean valid(String key) {
        return dir != null && key != null && KEY.matcher(key).matches();
    }

    private static File file(String key) {
        return new File(dir, key + ".json");
    }

    private static String read(File f) {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[16384];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            return new String(buf.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            Log.w(TAG, "чтение " + f, e);
            return null;
        }
    }
}
