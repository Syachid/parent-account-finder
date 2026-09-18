-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.

-- Local mirror of SalesCRM Account records (Indonesia record type only — see
-- ACCOUNT_RECORD_TYPE_ID in backend/main.py), kept in sync by the backend's periodic
-- sync job (default weekly) and the "Sync now" endpoint. Every ID lookup and batch run
-- reads from this mirror rather than querying CRM live, so duplicate-name detection can
-- scan the whole Indonesia Account set (not just a per-request search result) — same
-- approach as the sibling Account Parent-Mapping Monitor app.
-- phone_digits/tax_id_digits/identification_number_digits are the digits-only form of
-- phone/tax_id/identification_number (strips formatting like dashes/spaces/"+62", and
-- for free treats junk placeholders like "NA"/"-" as blank once non-digits are
-- stripped), NULL when fewer than 6 digits remain (too short to be a real number).
-- Stored and indexed at sync time so a per-lookup identity match is an indexed
-- equality query instead of a full-table scan-and-normalize.
CREATE TABLE accounts_mirror (
    id                            BIGINT       NOT NULL,       -- CRM Account id
    name                          VARCHAR(500) NOT NULL,
    normalized_name               VARCHAR(500) NOT NULL,
    owner_id                      BIGINT       NULL,
    owner_name                    VARCHAR(255) NULL,
    parent_account_id             BIGINT       NULL,
    phone                         VARCHAR(50)  NULL,
    tax_id                        VARCHAR(100) NULL,
    identification_number        VARCHAR(100) NULL,
    phone_digits                  VARCHAR(30)  NULL,
    tax_id_digits                 VARCHAR(30)  NULL,
    identification_number_digits  VARCHAR(30)  NULL,
    created_at_crm                DATETIME     NULL,           -- CRM's own created_at, for oldest-in-group logic
    synced_at                     DATETIME     NOT NULL,
    PRIMARY KEY (id),
    INDEX idx_normalized_name (normalized_name),
    INDEX idx_phone_digits (phone_digits),
    INDEX idx_tax_id_digits (tax_id_digits),
    INDEX idx_identification_number_digits (identification_number_digits)
) DEFAULT CHARSET=utf8mb4;

-- Near-duplicate Account name pairs found by fuzzy matching (rapidfuzz
-- token_sort_ratio), computed once per sync rather than live on every lookup —
-- comparing 100k+ distinct names, even blocked, is too slow to run inside an HTTP
-- request. Pruned and repopulated on every sync (see do_sync in main.py), same
-- "delete rows older than this run" pattern as accounts_mirror.
CREATE TABLE fuzzy_matches (
    id                 BIGINT       NOT NULL AUTO_INCREMENT,
    normalized_name_a  VARCHAR(500) NOT NULL,
    normalized_name_b  VARCHAR(500) NOT NULL,
    similarity         INT          NOT NULL,  -- 0-100, rapidfuzz token_sort_ratio
    computed_at        DATETIME     NOT NULL,
    PRIMARY KEY (id),
    INDEX idx_computed_at (computed_at),
    INDEX idx_name_a (normalized_name_a),
    INDEX idx_name_b (normalized_name_b)
) DEFAULT CHARSET=utf8mb4;

-- Tracks mirror sync runs so the frontend can show "last synced at".
CREATE TABLE sync_runs (
    id            BIGINT   NOT NULL AUTO_INCREMENT,
    started_at    DATETIME NOT NULL,
    finished_at   DATETIME NULL,
    accounts_seen INT      NOT NULL DEFAULT 0,
    upserted      INT      NOT NULL DEFAULT 0,
    sync_trigger  VARCHAR(20) NOT NULL DEFAULT 'scheduled',  -- 'scheduled' | 'manual' ("trigger" is a MySQL reserved word)
    error         TEXT     NULL,
    PRIMARY KEY (id)
) DEFAULT CHARSET=utf8mb4;

-- One row per batch lookup (pasted ID list or Excel upload). Results are stored as a
-- JSON blob rather than a separate rows table — a batch is bounded by what a user
-- pastes/uploads (tens to low hundreds of IDs), not the full Account mirror, so there's
-- no volume reason to normalize it out. Read/written by POST /api/lookup/batch,
-- POST /api/upload, and the GET /api/lookup/batch/{id}/... endpoints in main.py.
CREATE TABLE lookup_jobs (
    id           BIGINT   NOT NULL AUTO_INCREMENT,
    status       VARCHAR(20) NOT NULL DEFAULT 'running',  -- 'running' | 'done' | 'error'
    source       VARCHAR(20) NOT NULL,                    -- 'paste' | 'upload'
    created_at   DATETIME NOT NULL,
    finished_at  DATETIME NULL,
    total        INT      NOT NULL DEFAULT 0,
    processed    INT      NOT NULL DEFAULT 0,
    results_json LONGTEXT NULL,
    error        TEXT     NULL,
    PRIMARY KEY (id)
) DEFAULT CHARSET=utf8mb4;
