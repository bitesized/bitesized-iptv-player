// Numbered schema migrations, applied in order via PRAGMA user_version.
// Migrations are embedded strings so they bundle cleanly; never edit a shipped
// migration — append a new one.

export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    sql: /* sql */ `
      CREATE TABLE providers (
        id             INTEGER PRIMARY KEY,
        type           TEXT NOT NULL CHECK (type IN ('xtream', 'm3u')),
        name           TEXT NOT NULL,
        base_url       TEXT,
        username       TEXT,
        enc_password   BLOB,
        m3u_url        TEXT,
        epg_url        TEXT,
        last_sync_at   INTEGER,
        status         TEXT NOT NULL DEFAULT 'never_synced',
        status_message TEXT
      );

      CREATE TABLE profiles (
        id       INTEGER PRIMARY KEY,
        name     TEXT NOT NULL,
        avatar   TEXT,
        is_kids  INTEGER NOT NULL DEFAULT 0,
        pin_hash TEXT
      );

      CREATE TABLE categories (
        id          INTEGER PRIMARY KEY,
        provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL CHECK (kind IN ('live', 'vod', 'series')),
        remote_id   TEXT NOT NULL,
        name        TEXT NOT NULL,
        deleted     INTEGER NOT NULL DEFAULT 0,
        UNIQUE (provider_id, kind, remote_id)
      );
      CREATE INDEX idx_categories_provider_kind ON categories(provider_id, kind);

      CREATE TABLE channels (
        id             INTEGER PRIMARY KEY,
        provider_id    INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        stream_id      TEXT NOT NULL,
        name           TEXT NOT NULL,
        logo           TEXT,
        stream_type    TEXT,
        tv_archive     INTEGER NOT NULL DEFAULT 0,
        epg_channel_id TEXT,
        num            INTEGER,
        added_at       INTEGER,
        deleted        INTEGER NOT NULL DEFAULT 0,
        UNIQUE (provider_id, stream_id)
      );
      CREATE INDEX idx_channels_browse ON channels(provider_id, category_id, id);
      CREATE INDEX idx_channels_name ON channels(name);
      CREATE INDEX idx_channels_epg ON channels(epg_channel_id);

      CREATE TABLE vod (
        id            INTEGER PRIMARY KEY,
        provider_id   INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        stream_id     TEXT NOT NULL,
        name          TEXT NOT NULL,
        cover         TEXT,
        rating        REAL,
        added_at      INTEGER,
        container_ext TEXT,
        tmdb_id       TEXT,
        plot          TEXT,
        duration_secs INTEGER,
        deleted       INTEGER NOT NULL DEFAULT 0,
        UNIQUE (provider_id, stream_id)
      );
      CREATE INDEX idx_vod_browse ON vod(provider_id, category_id, id);
      CREATE INDEX idx_vod_name ON vod(name);
      CREATE INDEX idx_vod_added ON vod(added_at);

      CREATE TABLE series (
        id           INTEGER PRIMARY KEY,
        provider_id  INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        series_id    TEXT NOT NULL,
        name         TEXT NOT NULL,
        cover        TEXT,
        plot         TEXT,
        rating       REAL,
        genre        TEXT,
        release_date TEXT,
        deleted      INTEGER NOT NULL DEFAULT 0,
        UNIQUE (provider_id, series_id)
      );
      CREATE INDEX idx_series_browse ON series(provider_id, category_id, id);
      CREATE INDEX idx_series_name ON series(name);

      CREATE TABLE episodes (
        id            INTEGER PRIMARY KEY,
        series_id     INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
        season        INTEGER NOT NULL,
        episode_num   INTEGER NOT NULL,
        remote_id     TEXT NOT NULL,
        title         TEXT,
        container_ext TEXT,
        duration_secs INTEGER,
        plot          TEXT,
        still         TEXT,
        UNIQUE (series_id, season, episode_num)
      );

      CREATE TABLE epg_programmes (
        id             INTEGER PRIMARY KEY,
        epg_channel_id TEXT NOT NULL,
        start          INTEGER NOT NULL,
        stop           INTEGER NOT NULL,
        title          TEXT NOT NULL,
        description    TEXT,
        category       TEXT,
        UNIQUE (epg_channel_id, start)
      );
      CREATE INDEX idx_epg_window ON epg_programmes(epg_channel_id, start, stop);

      CREATE TABLE favorites (
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        item_type  TEXT NOT NULL CHECK (item_type IN ('live', 'vod', 'series')),
        item_id    INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, item_type, item_id)
      );

      CREATE TABLE watch_history (
        profile_id    INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        item_type     TEXT NOT NULL CHECK (item_type IN ('vod', 'episode', 'live')),
        item_id       INTEGER NOT NULL,
        position_secs REAL NOT NULL DEFAULT 0,
        duration_secs REAL,
        updated_at    INTEGER NOT NULL,
        completed     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (profile_id, item_type, item_id)
      );
      CREATE INDEX idx_history_recent ON watch_history(profile_id, updated_at DESC);

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    name: 'fts5-search',
    sql: /* sql */ `
      CREATE VIRTUAL TABLE channels_fts USING fts5(
        name,
        content='channels',
        content_rowid='id',
        tokenize = 'unicode61 remove_diacritics 2',
        prefix = '2 3'
      );
      CREATE TRIGGER channels_ai AFTER INSERT ON channels BEGIN
        INSERT INTO channels_fts(rowid, name) VALUES (new.id, new.name);
      END;
      CREATE TRIGGER channels_ad AFTER DELETE ON channels BEGIN
        INSERT INTO channels_fts(channels_fts, rowid, name) VALUES ('delete', old.id, old.name);
      END;
      CREATE TRIGGER channels_au AFTER UPDATE OF name ON channels BEGIN
        INSERT INTO channels_fts(channels_fts, rowid, name) VALUES ('delete', old.id, old.name);
        INSERT INTO channels_fts(rowid, name) VALUES (new.id, new.name);
      END;

      CREATE VIRTUAL TABLE vod_fts USING fts5(
        name,
        content='vod',
        content_rowid='id',
        tokenize = 'unicode61 remove_diacritics 2',
        prefix = '2 3'
      );
      CREATE TRIGGER vod_ai AFTER INSERT ON vod BEGIN
        INSERT INTO vod_fts(rowid, name) VALUES (new.id, new.name);
      END;
      CREATE TRIGGER vod_ad AFTER DELETE ON vod BEGIN
        INSERT INTO vod_fts(vod_fts, rowid, name) VALUES ('delete', old.id, old.name);
      END;
      CREATE TRIGGER vod_au AFTER UPDATE OF name ON vod BEGIN
        INSERT INTO vod_fts(vod_fts, rowid, name) VALUES ('delete', old.id, old.name);
        INSERT INTO vod_fts(rowid, name) VALUES (new.id, new.name);
      END;

      CREATE VIRTUAL TABLE series_fts USING fts5(
        name,
        content='series',
        content_rowid='id',
        tokenize = 'unicode61 remove_diacritics 2',
        prefix = '2 3'
      );
      CREATE TRIGGER series_ai AFTER INSERT ON series BEGIN
        INSERT INTO series_fts(rowid, name) VALUES (new.id, new.name);
      END;
      CREATE TRIGGER series_ad AFTER DELETE ON series BEGIN
        INSERT INTO series_fts(series_fts, rowid, name) VALUES ('delete', old.id, old.name);
      END;
      CREATE TRIGGER series_au AFTER UPDATE OF name ON series BEGIN
        INSERT INTO series_fts(series_fts, rowid, name) VALUES ('delete', old.id, old.name);
        INSERT INTO series_fts(rowid, name) VALUES (new.id, new.name);
      END;
    `
  },
  {
    version: 3,
    name: 'series-added-at',
    sql: /* sql */ `
      ALTER TABLE series ADD COLUMN added_at INTEGER;
      CREATE INDEX idx_series_added ON series(added_at);
    `
  },
  {
    version: 4,
    name: 'provider-max-connections',
    // Concurrent-connection cap the panel reports in user_info.max_connections.
    // NULL = unknown/unlimited; used to serialise stream opens per provider.
    sql: /* sql */ `
      ALTER TABLE providers ADD COLUMN max_connections INTEGER;
    `
  },
  {
    version: 5,
    name: 'category-prefs',
    // Per-profile category display prefs: hide from the sidebar, and a manual
    // sort position (NULL = fall back to alphabetical). Rows exist only for
    // categories the user has touched.
    sql: /* sql */ `
      CREATE TABLE category_prefs (
        profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        hidden      INTEGER NOT NULL DEFAULT 0,
        position    INTEGER,
        PRIMARY KEY (profile_id, category_id)
      );
    `
  },
  {
    version: 6,
    name: 'vod-year-quality',
    // Parsed from the item name at sync time so Movies search can filter by
    // release year and quality bucket (4K/1080p/720p/SD).
    sql: /* sql */ `
      ALTER TABLE vod ADD COLUMN year INTEGER;
      ALTER TABLE vod ADD COLUMN quality TEXT;
      CREATE INDEX idx_vod_year ON vod(year);
      CREATE INDEX idx_vod_quality ON vod(quality);
    `
  },
  {
    version: 7,
    name: 'browse-sort-indexes',
    // Browse pages are ORDER BY <sort key>, id over `deleted = 0` rows. Without
    // an index matching that order SQLite sorted the *whole* catalog for every
    // page (a temp B-tree per keystroke of scroll on a 100k list), and the
    // sidebar's per-category COUNT(*) went to the table for every row.
    //
    // These are partial indexes on the `deleted = 0` predicate every browse
    // query carries: smaller than full indexes, and category-leading ones become
    // covering for the counts. Old plain name/added indexes are dropped — the
    // pagers sort names COLLATE NOCASE (which a BINARY index can't serve) and
    // added_at DESC.
    sql: /* sql */ `
      DROP INDEX IF EXISTS idx_channels_name;
      DROP INDEX IF EXISTS idx_vod_name;
      DROP INDEX IF EXISTS idx_vod_added;
      DROP INDEX IF EXISTS idx_series_name;
      DROP INDEX IF EXISTS idx_series_added;

      CREATE INDEX idx_channels_by_num ON channels(num, id) WHERE deleted = 0;
      CREATE INDEX idx_channels_cat_num ON channels(category_id, num, id) WHERE deleted = 0;
      CREATE INDEX idx_channels_by_added ON channels(added_at DESC, id) WHERE deleted = 0;
      CREATE INDEX idx_channels_cat_added ON channels(category_id, added_at DESC, id) WHERE deleted = 0;

      CREATE INDEX idx_vod_by_name ON vod(name COLLATE NOCASE, id) WHERE deleted = 0;
      CREATE INDEX idx_vod_cat_name ON vod(category_id, name COLLATE NOCASE, id) WHERE deleted = 0;
      CREATE INDEX idx_vod_by_added ON vod(added_at DESC, id) WHERE deleted = 0;
      CREATE INDEX idx_vod_cat_added ON vod(category_id, added_at DESC, id) WHERE deleted = 0;

      CREATE INDEX idx_series_by_name ON series(name COLLATE NOCASE, id) WHERE deleted = 0;
      CREATE INDEX idx_series_cat_name ON series(category_id, name COLLATE NOCASE, id) WHERE deleted = 0;
      CREATE INDEX idx_series_by_added ON series(added_at DESC, id) WHERE deleted = 0;
      CREATE INDEX idx_series_cat_added ON series(category_id, added_at DESC, id) WHERE deleted = 0;
    `
  },
  {
    version: 8,
    name: 'encrypt-provider-urls',
    // An M3U playlist URL and an XMLTV URL both usually embed username/password,
    // so they are credentials in exactly the way the Xtream password is — but
    // they were stored as plaintext TEXT while the password went through the OS
    // keychain. These BLOB columns hold the safeStorage-encrypted form; the old
    // columns are cleared by the data migration in db/index.ts once copied over.
    sql: /* sql */ `
      ALTER TABLE providers ADD COLUMN enc_m3u_url BLOB;
      ALTER TABLE providers ADD COLUMN enc_epg_url BLOB;
    `
  }
]
