-- Leaderboard: top-cited papers snapshot, updated daily
CREATE TABLE IF NOT EXISTS leaderboard_rankings (
    snapshot_date TEXT NOT NULL,
    paper_id TEXT NOT NULL,
    rank INTEGER NOT NULL,
    citation_count INTEGER,
    PRIMARY KEY (snapshot_date, paper_id),
    FOREIGN KEY (paper_id) REFERENCES papers(id)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_date ON leaderboard_rankings(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_metrics_citation_count ON metrics(citation_count DESC);
