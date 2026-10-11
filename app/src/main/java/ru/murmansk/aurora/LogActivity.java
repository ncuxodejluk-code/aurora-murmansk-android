package ru.murmansk.aurora;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Экран «Журнал работы»: показывает журнал и последний сбой, позволяет отправить или скопировать его.
 * Сделан без WebView, чтобы открываться даже когда основной экран не работает.
 */
public class LogActivity extends Activity {
    static final String EXTRA_AFTER_CRASH = "afterCrash";
    private static final int FROST = 0xFFE8EEF7;
    private static final int HAZE = 0xFF9AA6C8;
    private static final int LINE = 0xFF2E3770;
    private static final int AURORA = 0xFF5BE3A3;
    private static final int SUN = 0xFFF5B14C;

    private TextView body;
    private String report = "";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Logs.init(this);
        boolean afterCrash = getIntent().getBooleanExtra(EXTRA_AFTER_CRASH, false) || Logs.hasNewCrash();
        Logs.markCrashSeen();
        drawBehindSystemBars();

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(WebHost.BACKGROUND);
        int pad = dp(18);

        TextView title = text("Журнал работы", 26, FROST);
        title.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
        root.addView(title, block(pad, dp(16), pad, 0));

        TextView lead = text(afterCrash
                ? "Приложение аварийно закрылось. Отправьте этот журнал разработчику — по нему видно, что сломалось."
                : "Если что-то работает не так, отправьте этот журнал разработчику.", 15, afterCrash ? SUN : HAZE);
        root.addView(lead, block(pad, dp(6), pad, 0));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.addView(button("Отправить", true, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                share();
            }
        }));
        row.addView(button("Скопировать", false, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                copy();
            }
        }), gap());
        row.addView(button("Очистить", false, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Logs.clear();
                Logs.i("AuroraLog", "журнал очищен");
                refresh();
            }
        }), gap());
        HorizontalScrollView rowScroll = new HorizontalScrollView(this);
        rowScroll.setHorizontalScrollBarEnabled(false);
        rowScroll.addView(row);
        root.addView(rowScroll, block(pad, dp(14), pad, dp(10)));

        Button forecast = button("Открыть прогноз", false, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(LogActivity.this, MainActivity.class)
                        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
                finish();
            }
        });
        root.addView(forecast, block(pad, 0, pad, dp(12)));

        body = text("", 12, FROST);
        body.setTypeface(Typeface.MONOSPACE);
        body.setTextIsSelectable(true);
        body.setPadding(pad, dp(12), pad, dp(24));
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(0xFF10142E);
        scroll.addView(body);
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);
        padForSystemBars(root);
        refresh();
    }

    private void refresh() {
        report = Logs.report();
        body.setText(report);
    }

    private void share() {
        Intent send = new Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_SUBJECT, "Журнал приложения «Сияние»");
        if (Logs.writeReportFile() != null) {
            // Файлом: мессенджеры не обрезают длинный журнал.
            Uri uri = LogFileProvider.reportUri();
            send.putExtra(Intent.EXTRA_STREAM, uri)
                    .putExtra(Intent.EXTRA_TEXT, "Журнал приложения «Сияние» во вложении")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            send.setClipData(ClipData.newRawUri("", uri));
        } else {
            send.putExtra(Intent.EXTRA_TEXT, report);
        }
        try {
            startActivity(Intent.createChooser(send, "Отправить журнал"));
        } catch (ActivityNotFoundException e) {
            copy();
        }
    }

    private void copy() {
        ClipboardManager cm = getSystemService(ClipboardManager.class);
        if (cm == null) return;
        cm.setPrimaryClip(ClipData.newPlainText("Журнал «Сияние»", report));
        Toast.makeText(this, "Журнал скопирован", Toast.LENGTH_SHORT).show();
    }

    // ───────────── Оформление ─────────────

    private TextView text(String s, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(color);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setLineSpacing(0, 1.2f);
        return t;
    }

    private Button button(String label, boolean primary, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        b.setTextColor(primary ? 0xFF0F2A20 : FROST);
        b.setMinHeight(dp(44));
        b.setMinimumHeight(dp(44));
        b.setPadding(dp(18), 0, dp(18), 0);
        b.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(22));
        if (primary) bg.setColor(AURORA);
        else {
            bg.setColor(Color.TRANSPARENT);
            bg.setStroke(dp(1), LINE);
        }
        b.setBackground(bg);
        b.setStateListAnimator(null);
        b.setOnClickListener(onClick);
        return b;
    }

    private LinearLayout.LayoutParams gap() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.leftMargin = dp(8);
        return lp;
    }

    private LinearLayout.LayoutParams block(int l, int t, int r, int b) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(l, t, r, b);
        return lp;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
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

    private void padForSystemBars(View root) {
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            @SuppressWarnings("deprecation")
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                if (Build.VERSION.SDK_INT >= 30) {
                    Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                } else {
                    v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                            insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                }
                return insets;
            }
        });
        root.requestApplyInsets();
    }
}
