-- Papers: core metadata for each ingested paper
CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,                    -- arXiv ID (e.g. "2401.12345")
    arxiv_id TEXT UNIQUE,
    doi TEXT,
    title TEXT NOT NULL,
    abstract TEXT NOT NULL,
    authors TEXT NOT NULL DEFAULT '[]',     -- JSON: [{name, affiliation}]
    published_date TEXT NOT NULL,           -- ISO date YYYY-MM-DD
    updated_date TEXT,
    categories TEXT NOT NULL DEFAULT '[]',  -- JSON: ["cs.AI", "cs.LG"]
    primary_category TEXT NOT NULL,
    pdf_url TEXT,
    source TEXT NOT NULL DEFAULT 'arxiv',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI-generated summaries (top 30 papers per day)
CREATE TABLE IF NOT EXISTS summaries (
    paper_id TEXT PRIMARY KEY,
    tldr TEXT NOT NULL,                     -- 2-3 sentence plain-language summary
    so_what TEXT NOT NULL,                  -- 1 sentence on broader importance
    tags TEXT NOT NULL DEFAULT '[]',        -- JSON: ["finance", "policy", "AI/ML"]
    difficulty INTEGER NOT NULL DEFAULT 3,  -- 1 (accessible) to 5 (specialist-only)
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    model TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
);

-- Scoring metrics per paper
CREATE TABLE IF NOT EXISTS metrics (
    paper_id TEXT PRIMARY KEY,
    citation_count INTEGER DEFAULT 0,
    citation_velocity REAL DEFAULT 0,           -- citations in last 12 months
    influential_citations INTEGER DEFAULT 0,
    altmetric_score REAL DEFAULT 0,
    news_count INTEGER DEFAULT 0,
    twitter_count INTEGER DEFAULT 0,
    patent_count INTEGER DEFAULT 0,
    wikipedia_count INTEGER DEFAULT 0,
    fields_of_study TEXT NOT NULL DEFAULT '[]', -- JSON: ["Computer Science", "Physics"]
    openalex_concepts TEXT NOT NULL DEFAULT '[]',-- JSON: ["Machine Learning", "Neural Networks"]
    h_index_avg REAL DEFAULT 0,                 -- average author h-index
    composite_score REAL NOT NULL DEFAULT 0,
    factor_breakdown TEXT NOT NULL DEFAULT '{}', -- JSON: {citation_vel, altmetric, bridge, author_rep, time_decay}
    scored_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
);

-- Daily ranked digests
CREATE TABLE IF NOT EXISTS daily_rankings (
    digest_date TEXT NOT NULL,              -- YYYY-MM-DD
    paper_id TEXT NOT NULL,
    rank INTEGER NOT NULL,
    composite_score REAL NOT NULL,
    PRIMARY KEY (digest_date, paper_id),
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
);

-- Author metadata cache
CREATE TABLE IF NOT EXISTS authors_cache (
    author_id TEXT PRIMARY KEY,             -- Semantic Scholar author ID
    name TEXT NOT NULL,
    h_index INTEGER DEFAULT 0,
    paper_count INTEGER DEFAULT 0,
    affiliations TEXT NOT NULL DEFAULT '[]',-- JSON: ["MIT", "Stanford"]
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pipeline run log
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'running', -- running | success | failed
    papers_fetched INTEGER DEFAULT 0,
    papers_scored INTEGER DEFAULT 0,
    papers_summarized INTEGER DEFAULT 0,
    error_message TEXT,
    stats TEXT NOT NULL DEFAULT '{}'        -- JSON with extra details
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_papers_published ON papers(published_date DESC);
CREATE INDEX IF NOT EXISTS idx_papers_primary_category ON papers(primary_category);
CREATE INDEX IF NOT EXISTS idx_metrics_composite ON metrics(composite_score DESC);
CREATE INDEX IF NOT EXISTS idx_daily_rankings_date ON daily_rankings(digest_date DESC, rank ASC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started ON pipeline_runs(started_at DESC);
