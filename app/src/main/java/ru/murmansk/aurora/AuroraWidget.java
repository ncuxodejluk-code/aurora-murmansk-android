package ru.murmansk.aurora;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Build;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.util.SizeF;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Виджет на главном экране. Подстраивается под размер:
 * в один ряд — время и шанс; от двух рядов — ещё график шанса на сутки вперёд;
 * если места много — облачность, темнота и ожидаемый выброс.
 */
public class AuroraWidget extends AppWidgetProvider {
    private static final String TAG = "AuroraWidget";
    private static final int FROST = 0xFFE8EEF7;
    private static final int HAZE = 0xFF9AA6C8;
    private static final int LINE = 0xFF2E3770;
    private static final int DIM = 0xFF8A94B8;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        render(ctx, mgr, ids);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle options) {
        render(ctx, mgr, new int[]{id});
    }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        if (mgr == null) return;
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, AuroraWidget.class));
        if (ids != null && ids.length > 0) render(ctx, mgr, ids);
    }

    private static void render(Context ctx, AppWidgetManager mgr, int[] ids) {
        Data d;
        try {
            Store.init(ctx);
            d = Data.load(ctx);
        } catch (RuntimeException e) {
            Logs.e(TAG, "данные виджета", e);
            d = Data.empty(ctx);
        }
        for (int id : ids) {
            try {
                mgr.updateAppWidget(id, build(ctx, d, mgr.getAppWidgetOptions(id)));
            } catch (RuntimeException e) {
                // Запасной простой вид, если с графиком что-то пошло не так.
                Logs.e(TAG, "виджет не обновился, показываю простой вид", e);
                try {
                    mgr.updateAppWidget(id, views(ctx, d, 250, 110, false));
                } catch (RuntimeException e2) {
                    Logs.e(TAG, "простой вид тоже не получился", e2);
                }
            }
        }
    }

    // ───────────── Размеры ─────────────

    private static RemoteViews build(Context ctx, Data d, Bundle opts) {
        if (Build.VERSION.SDK_INT >= 31) {
            List<SizeF> sizes = sizes(opts);
            if (sizes != null && !sizes.isEmpty()) {
                Map<SizeF, RemoteViews> map = new HashMap<>();
                for (SizeF s : sizes) {
                    if (map.size() >= 8) break;
                    map.put(s, views(ctx, d, s.getWidth(), s.getHeight(), true));
                }
                return new RemoteViews(map);
            }
        }
        // До Android 12: в портретной ориентации — минимальная ширина и максимальная высота, в альбомной — наоборот.
        int minW = opts != null ? opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) : 0;
        int maxW = opts != null ? opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH) : 0;
        int minH = opts != null ? opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT) : 0;
        int maxH = opts != null ? opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT) : 0;
        if (minW <= 0 || maxH <= 0) return views(ctx, d, 250, 140, true);
        RemoteViews portrait = views(ctx, d, minW, maxH, true);
        RemoteViews landscape = views(ctx, d, maxW > 0 ? maxW : minW, minH > 0 ? minH : maxH, true);
        return new RemoteViews(landscape, portrait);
    }

    @SuppressWarnings("deprecation")
    private static List<SizeF> sizes(Bundle opts) {
        if (opts == null) return null;
        if (Build.VERSION.SDK_INT >= 33) return opts.getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES, SizeF.class);
        ArrayList<SizeF> list = opts.getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES);
        return list;
    }

    // ───────────── Вид ─────────────

    private static RemoteViews views(Context ctx, Data d, float wDp, float hDp, boolean chart) {
        boolean compact = hDp < 100;
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), compact ? R.layout.widget_small : R.layout.widget_aurora);
        int color = levelColor(d.levelKey);

        rv.setTextViewText(R.id.w_time, d.time);
        rv.setTextViewText(R.id.w_chance, d.chance);
        rv.setViewVisibility(R.id.w_chance, d.chance.isEmpty() ? View.GONE : View.VISIBLE);
        rv.setTextColor(R.id.w_chance, color);
        rv.setTextViewText(R.id.w_kp, d.kp.isEmpty() ? "" : "Kp " + d.kp);

        // На узком виджете — «в ночь на 10 окт» вместо «в ночь с 9 на 10 октября».
        String when = wDp < 320 ? d.whenShort : d.when;
        if (compact) {
            rv.setTextViewText(R.id.w_line, join(" · ", d.place, when));
        } else {
            rv.setTextViewText(R.id.w_place, d.place);
            rv.setTextViewText(R.id.w_line, join(" · ", when, d.chanceLabel));
            rv.setTextColor(R.id.w_line, d.chanceLabel.isEmpty() ? HAZE : color);
            rv.setTextViewText(R.id.w_updated, d.updated);

            boolean roomy = hDp >= 230;
            rv.setTextViewText(R.id.w_info, d.info);
            rv.setViewVisibility(R.id.w_info, roomy && !d.info.isEmpty() ? View.VISIBLE : View.GONE);
            rv.setTextViewText(R.id.w_note, d.note);
            rv.setViewVisibility(R.id.w_note, roomy && !d.note.isEmpty() ? View.VISIBLE : View.GONE);

            boolean showChart = chart && d.bars.length >= 6 && d.hasDark() && hDp >= 145;
            if (showChart) {
                DisplayMetrics m = ctx.getResources().getDisplayMetrics();
                float textDp = textHeightDp(m, roomy && !d.info.isEmpty(), roomy && !d.note.isEmpty());
                float widthDp = Math.max(60, wDp - 28);
                float chartDp = Math.max(16, Math.min(140, hDp - 20 - textDp - 8 - 14));
                rv.setImageViewBitmap(R.id.w_chart, drawBars(d.bars, widthDp, chartDp, m));
                rv.setImageViewBitmap(R.id.w_axis, drawAxis(d.bars, widthDp, m));
            }
            rv.setViewVisibility(R.id.w_chart, showChart ? View.VISIBLE : View.GONE);
            rv.setViewVisibility(R.id.w_axis, showChart ? View.VISIBLE : View.GONE);
        }

        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(
                ctx, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        rv.setOnClickPendingIntent(R.id.w_root, pi);
        return rv;
    }

    /** Примерная высота текста над и под графиком, в dp, с учётом крупного шрифта в настройках. */
    private static float textHeightDp(DisplayMetrics m, boolean info, boolean note) {
        float k = m.density > 0 ? TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 1, m) / m.density : 1f;
        float h = 17 + 36 + 19 + 15;
        if (info) h += 20;
        if (note) h += 34;
        return h * k;
    }

    private static String join(String sep, String a, String b) {
        if (a.isEmpty()) return b;
        if (b.isEmpty()) return a;
        return a + sep + b;
    }

    // ───────────── График ─────────────

    /** Столбики шанса по часам; тёмное время подсвечено полосой. Растягивается по высоте без искажений смысла. */
    private static Bitmap drawBars(Bar[] bars, float widthDp, float heightDp, DisplayMetrics m) {
        float scale = Math.min(m.density, 2f);
        int w = Math.max(24, Math.round(widthDp * scale));
        int h = Math.max(8, Math.round(heightDp * scale));
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        int n = bars.length;
        float gap = Math.max(1f, 2f * scale);
        float bw = (w - gap * (n - 1)) / n;
        float r = 1.5f * scale;

        // полоса темноты
        p.setColor(0x14FFFFFF);
        int i = 0;
        while (i < n) {
            if (bars[i].dark < 0.3) {
                i++;
                continue;
            }
            int j = i;
            while (j + 1 < n && bars[j + 1].dark >= 0.3) j++;
            float x0 = Math.max(0, i * (bw + gap) - gap / 2);
            float x1 = Math.min(w, j * (bw + gap) + bw + gap / 2);
            c.drawRoundRect(new RectF(x0, 0, x1, h), 3 * scale, 3 * scale, p);
            i = j + 1;
        }

        float top = 2 * scale;
        for (int k = 0; k < n; k++) {
            Bar b = bars[k];
            float x = k * (bw + gap);
            if (b.dark < 0.3) {
                // светло — сияния не видно: тонкая черта
                p.setColor(0x26FFFFFF);
                c.drawRect(x, h - Math.max(1f, scale), x + bw, h, p);
                continue;
            }
            float bh = Math.max(2 * scale, b.score * (h - top));
            p.setColor(b.score < 0.03 ? LINE : levelColor(b.level));
            c.drawRoundRect(new RectF(x, h - bh, x + bw, h), r, r, p);
        }
        return bmp;
    }

    /** Подписи часов под графиком: «сейчас» (или первый час), потом каждые 3 или 6 часов. */
    private static Bitmap drawAxis(Bar[] bars, float widthDp, DisplayMetrics m) {
        int w = Math.max(24, Math.round(widthDp * m.density));
        int h = Math.max(8, Math.round(14 * m.density));
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(DIM);
        p.setTextSize(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 10, m));
        Paint.FontMetrics fm = p.getFontMetrics();
        float baseline = (h - (fm.descent - fm.ascent)) / 2f - fm.ascent;
        int n = bars.length;
        float gap = Math.max(1f, 2f * m.density);
        float bw = (w - gap * (n - 1)) / n;
        float pad = 4 * m.density;

        int step = n <= 16 ? 3 : 6;
        String first = bars[0].now ? "сейчас" : hourText(bars[0].hour);
        c.drawText(first, 0, baseline, p);
        float lastRight = p.measureText(first);
        for (int k = 1; k < n; k++) {
            if (bars[k].hour % step != 0) continue;
            String t = hourText(bars[k].hour);
            float tw = p.measureText(t);
            float x = k * (bw + gap) + bw / 2 - tw / 2;
            x = Math.min(x, w - tw);
            if (x < lastRight + pad) continue;
            c.drawText(t, x, baseline, p);
            lastRight = x + tw;
        }
        return bmp;
    }

    private static String hourText(int h) {
        return String.format(java.util.Locale.US, "%02d:00", h);
    }

    private static int levelColor(String key) {
        switch (key) {
            case "high":
                return 0xFFC6A6FF;
            case "good":
                return 0xFF5BE3A3;
            case "medium":
                return 0xFF7FA6FF;
            case "low":
                return 0xFF8A94B8;
            default:
                return 0xFF6C7699;
        }
    }

    // ───────────── Данные из приложения ─────────────

    private static final class Bar {
        float score;
        float dark;
        String level;
        int hour;
        boolean now;
    }

    private static final class Data {
        String place;
        String kp = "";
        String time;
        String when;
        String whenShort;
        String chance = "";
        String chanceLabel = "";
        String levelKey = "";
        String info = "";
        String note = "";
        String updated = "";
        Bar[] bars = new Bar[0];

        boolean hasDark() {
            for (Bar b : bars) if (b.dark >= 0.3) return true;
            return false;
        }

        static Data empty(Context ctx) {
            Data d = new Data();
            d.place = ctx.getString(R.string.widget_place_default);
            d.time = ctx.getString(R.string.widget_empty_time);
            d.when = ctx.getString(R.string.widget_empty_line);
            d.whenShort = d.when;
            return d;
        }

        static Data load(Context ctx) {
            Data d = empty(ctx);
            String raw = Store.get("widget");
            if (raw == null) return d;
            try {
                JSONObject o = new JSONObject(raw);
                d.place = o.optString("place", d.place);
                d.kp = o.optString("kp", "");
                d.time = o.optString("time", d.time);
                // «when» появился в версии с графиком; раньше был только «line».
                d.when = o.has("when") ? o.optString("when", "") : o.optString("line", d.when);
                d.whenShort = o.optString("whenShort", d.when);
                d.chance = o.optString("chance", "");
                d.chanceLabel = o.optString("chanceLabel", "");
                d.levelKey = o.optString("levelKey", "");
                d.info = o.optString("info", "");
                d.note = o.optString("note", "");
                d.updated = o.optString("updated", "");
                JSONArray arr = o.optJSONArray("bars");
                if (arr != null) {
                    List<Bar> list = new ArrayList<>();
                    for (int i = 0; i < arr.length() && i < 48; i++) {
                        JSONObject b = arr.optJSONObject(i);
                        if (b == null) continue;
                        Bar bar = new Bar();
                        bar.score = clamp((float) b.optDouble("s", 0));
                        bar.dark = clamp((float) b.optDouble("d", 0));
                        bar.level = b.optString("k", "none");
                        bar.hour = b.optInt("h", 0);
                        bar.now = b.optInt("now", 0) == 1;
                        list.add(bar);
                    }
                    d.bars = list.toArray(new Bar[0]);
                }
            } catch (JSONException e) {
                Logs.w(TAG, "не разобрал данные виджета: " + e);
            }
            return d;
        }

        private static float clamp(float v) {
            if (Float.isNaN(v)) return 0;
            return Math.max(0, Math.min(1, v));
        }
    }
}
