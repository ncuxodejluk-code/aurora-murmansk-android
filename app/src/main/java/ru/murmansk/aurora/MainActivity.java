package ru.murmansk.aurora;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.WebView;
import android.widget.FrameLayout;

/** Единственный экран: прогноз сияния в WebView. */
public class MainActivity extends Activity {
    private static final int REQ_NOTIFICATIONS = 7;
    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Logs.init(this);
        Store.init(this);
        // После сбоя сначала показываем журнал, чтобы его можно было отправить.
        if (Logs.hasNewCrash()) {
            openLogs(true);
            return;
        }
        drawBehindSystemBars();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(WebHost.BACKGROUND);
        try {
            web = new WebView(this);
        } catch (RuntimeException e) {
            Logs.e("AuroraMain", "не удалось создать WebView", e);
            openLogs(true);
            return;
        }
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        padForSystemBars(root);

        WebHost.configure(web, new Bridge(this, web, null), new Runnable() {
            @Override
            public void run() {
                recreate();
            }
        });
        WebHub.register(web);
        web.loadUrl(WebHost.BASE + "index.html");
        Logs.i("AuroraMain", "экран открыт");

        askForNotificationsOnce();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.evaluateJavascript("window.__auroraResume&&window.__auroraResume()", null);
        }
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            WebHub.unregister(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == REQ_NOTIFICATIONS && web != null) {
            web.evaluateJavascript("window.__auroraResume&&window.__auroraResume()", null);
        }
    }

    private void openLogs(boolean afterCrash) {
        startActivity(new Intent(this, LogActivity.class).putExtra(LogActivity.EXTRA_AFTER_CRASH, afterCrash));
        finish();
    }

    /** Единственное разрешение приложения — уведомления; спрашиваем один раз при первом запуске. */
    private void askForNotificationsOnce() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        SharedPreferences prefs = getSharedPreferences("app", MODE_PRIVATE);
        if (prefs.getBoolean("askedNotifications", false)) return;
        prefs.edit().putBoolean("askedNotifications", true).apply();
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
    }

    @SuppressWarnings("deprecation")
    private void drawBehindSystemBars() {
        Window w = getWindow();
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    /** Отступы под строку состояния, панель навигации, вырез экрана и клавиатуру. */
    private void padForSystemBars(View root) {
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            @SuppressWarnings("deprecation")
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int left;
                int top;
                int right;
                int bottom;
                if (Build.VERSION.SDK_INT >= 30) {
                    Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    Insets ime = insets.getInsets(WindowInsets.Type.ime());
                    left = bars.left;
                    top = bars.top;
                    right = bars.right;
                    bottom = Math.max(bars.bottom, ime.bottom);
                } else {
                    left = insets.getSystemWindowInsetLeft();
                    top = insets.getSystemWindowInsetTop();
                    right = insets.getSystemWindowInsetRight();
                    bottom = insets.getSystemWindowInsetBottom();
                }
                v.setPadding(left, top, right, bottom);
                return insets;
            }
        });
        root.requestApplyInsets();
    }
}
