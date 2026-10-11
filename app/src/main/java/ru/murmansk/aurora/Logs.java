package ru.murmansk.aurora;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Process;
import android.util.Log;
import android.webkit.WebView;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Журнал работы приложения в файлах: обычные записи, ошибки страниц и сбои.
 * Его можно открыть и отправить с экрана «Журнал работы».
 */
final class Logs {
    private static final String TAG = "Aurora";
    private static final long MAX_LOG = 200 * 1024;
    private static final int MAX_REPORT = 100 * 1024;
    private static File dir;
    private static Context app;

    private Logs() {
    }

    /** Вызывается первым делом при запуске — до всего, что может упасть. */
    static synchronized void init(Context ctx) {
        if (dir != null) return;
        app = ctx.getApplicationContext();
        dir = new File(app.getFilesDir(), "logs");
        if (!dir.exists() && !dir.mkdirs()) Log.w(TAG, "не удалось создать папку журнала");
        installCrashHandler();
    }

    static void i(String tag, String msg) {
        Log.i(tag, msg);
        write("I", tag, msg, null);
    }

    static void w(String tag, String msg) {
        Log.w(tag, msg);
        write("W", tag, msg, null);
    }

    static void e(String tag, String msg, Throwable t) {
        Log.e(tag, msg, t);
        write("E", tag, msg, t);
    }

    private static synchronized void write(String level, String tag, String msg, Throwable t) {
        if (dir == null) return;
        StringBuilder sb = new StringBuilder();
        sb.append(stamp()).append(' ').append(level).append(' ').append(tag).append(": ").append(msg).append('\n');
        if (t != null) sb.append(stack(t));
        File f = new File(dir, "app.log");
        if (f.length() > MAX_LOG) {
            File old = new File(dir, "app.old.log");
            if (old.exists() && !old.delete()) Log.w(TAG, "не удалось удалить старый журнал");
            if (!f.renameTo(old)) Log.w(TAG, "не удалось повернуть журнал");
        }
        try (FileOutputStream out = new FileOutputStream(f, true)) {
            out.write(sb.toString().getBytes(StandardCharsets.UTF_8));
        } catch (IOException ex) {
            Log.w(TAG, "запись журнала", ex);
        }
    }

    // ───────────── Сбои ─────────────

    private static void installCrashHandler() {
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread thread, Throwable error) {
                try {
                    saveCrash(thread, error);
                } catch (Throwable ignored) {
                    // журнал не должен мешать системе закрыть приложение
                }
                if (previous != null) {
                    previous.uncaughtException(thread, error);
                } else {
                    Process.killProcess(Process.myPid());
                    System.exit(10);
                }
            }
        });
    }

    private static synchronized void saveCrash(Thread thread, Throwable error) {
        if (dir == null) return;
        String text = "Сбой " + stamp() + " в потоке «" + thread.getName() + "»\n" + stack(error);
        write("E", "CRASH", "приложение аварийно закрылось", error);
        try (FileOutputStream out = new FileOutputStream(new File(dir, "crash.txt"), false)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        } catch (IOException ignored) {
            // нечего делать
        }
    }

    /** Есть сбой, который пользователь ещё не видел. */
    static synchronized boolean hasNewCrash() {
        if (dir == null) return false;
        File crash = new File(dir, "crash.txt");
        File seen = new File(dir, "crash.seen");
        return crash.exists() && (!seen.exists() || seen.lastModified() < crash.lastModified());
    }

    static synchronized void markCrashSeen() {
        if (dir == null) return;
        File seen = new File(dir, "crash.seen");
        try (FileOutputStream out = new FileOutputStream(seen, false)) {
            out.write('1');
        } catch (IOException ignored) {
            return;
        }
        if (!seen.setLastModified(System.currentTimeMillis())) Log.w(TAG, "отметка сбоя");
    }

    static synchronized void clear() {
        if (dir == null) return;
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (!f.delete()) Log.w(TAG, "не удалось удалить " + f.getName());
        }
    }

    // ───────────── Отчёт для отправки ─────────────

    static synchronized String report() {
        StringBuilder sb = new StringBuilder();
        sb.append("Сияние над Мурманском — журнал работы\n");
        sb.append("Создан: ").append(stamp()).append('\n');
        sb.append("Приложение: ").append(appVersion()).append('\n');
        sb.append("Устройство: ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL)
                .append(", Android ").append(Build.VERSION.RELEASE).append(" (API ").append(Build.VERSION.SDK_INT).append(")\n");
        sb.append("WebView: ").append(webViewVersion()).append('\n');
        sb.append("Уведомления разрешены: ").append(app != null && Notifier.allowed(app) ? "да" : "нет").append('\n');

        if (dir != null) {
            File crash = new File(dir, "crash.txt");
            if (crash.exists()) {
                sb.append("\n=== Последний сбой ===\n").append(read(crash, 30 * 1024));
            }
            sb.append("\n=== Журнал ===\n");
            String old = read(new File(dir, "app.old.log"), MAX_REPORT / 2);
            String cur = read(new File(dir, "app.log"), MAX_REPORT);
            String all = old + cur;
            if (all.length() > MAX_REPORT) all = "…\n" + all.substring(all.length() - MAX_REPORT);
            sb.append(all.isEmpty() ? "(пусто)\n" : all);
        }
        return sb.toString();
    }

    /** Сохраняет отчёт в файл, чтобы отправить его вложением. */
    static synchronized java.io.File writeReportFile() {
        if (dir == null) return null;
        File f = new File(dir, "report.txt");
        try (FileOutputStream out = new FileOutputStream(f, false)) {
            out.write(report().getBytes(StandardCharsets.UTF_8));
            return f;
        } catch (IOException e) {
            Log.w(TAG, "файл отчёта", e);
            return null;
        }
    }

    private static String appVersion() {
        if (app == null) return "?";
        try {
            PackageInfo p = app.getPackageManager().getPackageInfo(app.getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : legacyCode(p);
            return p.versionName + " (" + code + ")";
        } catch (PackageManager.NameNotFoundException e) {
            return "?";
        }
    }

    @SuppressWarnings("deprecation")
    private static long legacyCode(PackageInfo p) {
        return p.versionCode;
    }

    private static String webViewVersion() {
        try {
            PackageInfo p = WebView.getCurrentWebViewPackage();
            return p == null ? "не найден" : p.packageName + " " + p.versionName;
        } catch (RuntimeException e) {
            return "ошибка: " + e;
        }
    }

    private static String read(File f, int maxBytes) {
        if (!f.exists()) return "";
        try (InputStream in = new FileInputStream(f)) {
            long skip = f.length() - maxBytes;
            if (skip > 0 && in.skip(skip) < skip) return "";
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[16384];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            return new String(buf.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "(не удалось прочитать " + f.getName() + ": " + e + ")\n";
        }
    }

    private static String stack(Throwable t) {
        StringWriter sw = new StringWriter();
        t.printStackTrace(new PrintWriter(sw));
        return sw.toString();
    }

    private static String stamp() {
        return new SimpleDateFormat("dd.MM HH:mm:ss.SSS", Locale.US).format(new Date());
    }
}
