package ru.murmansk.aurora;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import org.json.JSONException;
import org.json.JSONObject;

/** Виджет на главном экране: окно наблюдения, шанс и текущий Kp. */
public class AuroraWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        render(ctx, mgr, ids);
    }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        if (mgr == null) return;
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, AuroraWidget.class));
        if (ids != null && ids.length > 0) render(ctx, mgr, ids);
    }

    private static void render(Context ctx, AppWidgetManager mgr, int[] ids) {
        Store.init(ctx);
        String place = ctx.getString(R.string.widget_place_default);
        String kp = "—";
        String time = ctx.getString(R.string.widget_empty_time);
        String line = ctx.getString(R.string.widget_empty_line);
        String updated = "";
        int color = 0xFF9AA6C8;

        String raw = Store.get("widget");
        if (raw != null) {
            try {
                JSONObject o = new JSONObject(raw);
                place = o.optString("place", place);
                kp = o.optString("kp", kp);
                time = o.optString("time", time);
                line = o.optString("line", line);
                updated = o.optString("updated", "");
                color = levelColor(o.optString("levelKey", ""));
            } catch (JSONException e) {
                // остаются значения по умолчанию
            }
        }

        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_aurora);
        rv.setTextViewText(R.id.w_place, ctx.getString(R.string.widget_place_kp, place, kp));
        rv.setTextViewText(R.id.w_time, time);
        rv.setTextViewText(R.id.w_line, line);
        rv.setTextColor(R.id.w_line, color);
        rv.setTextViewText(R.id.w_updated, updated);

        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(
                ctx, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        rv.setOnClickPendingIntent(R.id.w_root, pi);

        for (int id : ids) mgr.updateAppWidget(id, rv);
    }

    private static int levelColor(String key) {
        switch (key) {
            case "high":
                return 0xFFC6A6FF;
            case "good":
                return 0xFF5BE3A3;
            case "medium":
                return 0xFF7FA6FF;
            default:
                return 0xFF9AA6C8;
        }
    }
}
