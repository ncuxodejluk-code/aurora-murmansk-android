package ru.murmansk.aurora;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/** Отдаёт файл журнала приложению, через которое пользователь его отправляет (Telegram, почта и т. п.). */
public class LogFileProvider extends ContentProvider {
    static final String AUTHORITY = "ru.murmansk.aurora.logs";
    static final String NAME = "aurora-log.txt";

    static Uri reportUri() {
        return Uri.parse("content://" + AUTHORITY + "/" + NAME);
    }

    private File report() {
        return new File(new File(getContext().getFilesDir(), "logs"), "report.txt");
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public String getType(Uri uri) {
        return "text/plain";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        c.addRow(new Object[]{NAME, report().length()});
        return c;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("только чтение");
        return ParcelFileDescriptor.open(report(), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] args) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] args) {
        return 0;
    }
}
