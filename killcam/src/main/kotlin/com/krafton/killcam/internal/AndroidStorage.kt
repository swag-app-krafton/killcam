package com.krafton.killcam.internal

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.os.SystemClock
import com.krafton.killcam.core.ApiException
import com.krafton.killcam.core.KillcamJson
import com.krafton.killcam.core.model.DbInfo
import com.krafton.killcam.core.model.DbTable
import com.krafton.killcam.core.model.PrefEntry
import com.krafton.killcam.core.model.PrefFile
import com.krafton.killcam.core.model.PrefType
import com.krafton.killcam.core.model.QueryResult
import com.krafton.killcam.core.platform.DatabaseProvider
import com.krafton.killcam.core.platform.PrefsProvider
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import java.io.File

/**
 * SharedPreferences through the real SharedPreferences API rather than the XML
 * files, so edits go through the same in-memory instance the app reads and
 * take effect immediately, without a restart.
 */
internal class AndroidPrefsProvider(private val context: Context) : PrefsProvider {
    private val dir = File(context.applicationInfo.dataDir, "shared_prefs")

    override fun files(): List<PrefFile> =
        dir.listFiles { file -> file.name.endsWith(".xml") }.orEmpty()
            .map { it.name.removeSuffix(".xml") }
            .filterNot { it.startsWith("killcam_") }
            .sorted()
            .map { name -> PrefFile(name, prefs(name).all.size, File(dir, "$name.xml").length()) }

    override fun entries(file: String): List<PrefEntry>? {
        if (!exists(file)) return null
        return prefs(file).all.entries.sortedBy { it.key }.map { (key, value) -> entry(key, value) }
    }

    override fun put(file: String, entry: PrefEntry): PrefEntry {
        val editor = prefs(file).edit()
        try {
            when (entry.type) {
                PrefType.String -> editor.putString(entry.key, entry.value)
                PrefType.Boolean -> editor.putBoolean(entry.key, entry.value.toBooleanStrict())
                PrefType.Int -> editor.putInt(entry.key, entry.value.trim().toInt())
                PrefType.Long -> editor.putLong(entry.key, entry.value.trim().toLong())
                PrefType.Float -> editor.putFloat(entry.key, entry.value.trim().toFloat())
                PrefType.StringSet -> editor.putStringSet(
                    entry.key,
                    KillcamJson.decodeFromString(ListSerializer(String.serializer()), entry.value).toSet(),
                )
            }
        } catch (e: IllegalArgumentException) {
            throw ApiException(400, "'${entry.value}' is not a valid ${entry.type.name.lowercase()}")
        }
        if (!editor.commit()) throw ApiException(500, "Could not write $file")
        return entry(entry.key, prefs(file).all[entry.key])
    }

    override fun remove(file: String, key: String): Boolean {
        if (!exists(file)) return false
        val prefs = prefs(file)
        if (!prefs.contains(key)) return false
        return prefs.edit().remove(key).commit()
    }

    private fun exists(file: String) = !file.contains('/') && File(dir, "$file.xml").isFile

    private fun prefs(name: String) = context.getSharedPreferences(name, Context.MODE_PRIVATE)

    private fun entry(key: String, value: Any?): PrefEntry = when (value) {
        is Boolean -> PrefEntry(key, PrefType.Boolean, value.toString())
        is Int -> PrefEntry(key, PrefType.Int, value.toString())
        is Long -> PrefEntry(key, PrefType.Long, value.toString())
        is Float -> PrefEntry(key, PrefType.Float, value.toString())
        is Set<*> -> PrefEntry(
            key, PrefType.StringSet,
            KillcamJson.encodeToString(ListSerializer(String.serializer()), value.map { it.toString() }.sorted()),
        )
        else -> PrefEntry(key, PrefType.String, value?.toString() ?: "")
    }
}

/**
 * The app's SQLite databases (Room included). Each request opens its own
 * connection and closes it, so Killcam never holds a lock the app is waiting
 * on between requests. Table and column names from the dashboard are checked
 * against the schema before being put into SQL.
 */
internal class AndroidDatabaseProvider(private val context: Context) : DatabaseProvider {

    override fun databases(): List<DbInfo> =
        context.databaseList()
            .filterNot { name -> SIDE_FILES.any { name.endsWith(it) } }
            .sorted()
            .mapNotNull { name ->
                val file = context.getDatabasePath(name)
                if (!file.isFile) return@mapNotNull null
                runCatching {
                    open(name).use { db ->
                        DbInfo(name, file.absolutePath, file.length(), tables(db))
                    }
                }.getOrElse { DbInfo(name, file.absolutePath, file.length(), emptyList()) }
            }

    override fun browse(database: String, table: String, offset: Int, limit: Int, orderBy: String?, descending: Boolean): QueryResult {
        val started = SystemClock.elapsedRealtime()
        return runCatching {
            open(database).use { db ->
                val known = tables(db).firstOrNull { it.name == table } ?: return QueryResult.failure("No table '$table'")
                val columns = db.rawQuery("PRAGMA table_info(${quote(table)})", null).use { c ->
                    buildList { while (c.moveToNext()) add(c.getString(1)) }
                }
                val order = orderBy?.takeIf { it in columns }?.let { " ORDER BY ${quote(it)}${if (descending) " DESC" else ""}" }.orEmpty()
                val total = known.rowCount ?: db.count("SELECT COUNT(*) FROM ${quote(table)}")
                db.rawQuery("SELECT * FROM ${quote(table)}$order LIMIT $limit OFFSET $offset", null).use { cursor ->
                    read(cursor, limit).copy(totalRows = total, elapsedMs = SystemClock.elapsedRealtime() - started)
                }
            }
        }.getOrElse { QueryResult.failure(it.message ?: it.javaClass.simpleName, SystemClock.elapsedRealtime() - started) }
    }

    override fun query(database: String, sql: String): QueryResult {
        val started = SystemClock.elapsedRealtime()
        val statement = sql.trim().trimEnd(';')
        if (statement.isEmpty()) return QueryResult.failure("Empty statement")
        return runCatching {
            open(database).use { db ->
                val verb = statement.substringBefore(' ').substringBefore('\n').lowercase()
                if (verb in READ_VERBS) {
                    db.rawQuery(statement, null).use { cursor ->
                        read(cursor, MAX_ROWS).copy(elapsedMs = SystemClock.elapsedRealtime() - started)
                    }
                } else {
                    db.execSQL(statement)
                    val changed = db.count("SELECT changes()")
                    QueryResult(emptyList(), emptyList(), null, changed, false, SystemClock.elapsedRealtime() - started, null)
                }
            }
        }.getOrElse { QueryResult.failure(it.message ?: it.javaClass.simpleName, SystemClock.elapsedRealtime() - started) }
    }

    private fun open(name: String): SQLiteDatabase {
        if (name.contains('/')) throw ApiException(400, "Bad database name")
        val file = context.getDatabasePath(name)
        if (!file.isFile) throw ApiException(404, "No database '$name'")
        return SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READWRITE)
    }

    private fun tables(db: SQLiteDatabase): List<DbTable> =
        db.rawQuery(
            "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
            null,
        ).use { c ->
            buildList {
                while (c.moveToNext()) {
                    val name = c.getString(0)
                    val type = c.getString(1)
                    // Counting a view can run an arbitrarily expensive query; only count tables.
                    val rows = if (type == "table") runCatching { db.count("SELECT COUNT(*) FROM ${quote(name)}") }.getOrNull() else null
                    add(DbTable(name, type, rows))
                }
            }
        }

    private fun read(cursor: Cursor, max: Int): QueryResult {
        val columns = cursor.columnNames.toList()
        val rows = ArrayList<List<JsonPrimitive>>()
        while (rows.size < max && cursor.moveToNext()) {
            rows += columns.indices.map { i ->
                when (cursor.getType(i)) {
                    Cursor.FIELD_TYPE_NULL -> JsonNull
                    Cursor.FIELD_TYPE_INTEGER -> JsonPrimitive(cursor.getLong(i))
                    Cursor.FIELD_TYPE_FLOAT -> JsonPrimitive(cursor.getDouble(i))
                    Cursor.FIELD_TYPE_BLOB -> JsonPrimitive("<blob ${cursor.getBlob(i).size} bytes>")
                    else -> JsonPrimitive(cursor.getString(i).let { if (it.length > MAX_CELL) it.take(MAX_CELL) + "…" else it })
                }
            }
        }
        val truncated = !cursor.isAfterLast && cursor.moveToNext()
        return QueryResult(columns, rows, null, null, truncated, 0, null)
    }

    private fun SQLiteDatabase.count(sql: String): Long = rawQuery(sql, null).use { if (it.moveToFirst()) it.getLong(0) else 0 }

    private fun quote(identifier: String) = "\"" + identifier.replace("\"", "\"\"") + "\""

    private companion object {
        val SIDE_FILES = listOf("-journal", "-wal", "-shm")
        val READ_VERBS = setOf("select", "pragma", "with", "explain", "values")
        const val MAX_ROWS = 500
        const val MAX_CELL = 4_000
    }
}
