-- Add list_type to leaderboard so we can have multiple ranked lists
-- (foundations = raw citations, momentum = foundational + accelerating)

-- Step 1: create new table with list_type in the primary key
CREATE TABLE IF NOT EXISTS leaderboard_rankings_new (
    snapshot_date TEXT NOT NULL,
    list_type TEXT NOT NULL,
    paper_id TEXT NOT NULL,
    rank INTEGER NOT NULL,
    citation_count INTEGER,
    score REAL,
    PRIMARY KEY (snapshot_date, list_type, paper_id),
    FOREIGN KEY (paper_id) REFERENCES papers(id)
);

-- Step 2: copy existing rows, classifying them as 'foundations'
INSERT INTO leaderboard_rankings_new (snapshot_date, list_type, paper_id, rank, citation_count)
SELECT snapshot_date, 'foundations', paper_id, rank, citation_count FROM leaderboard_rankings;

-- Step 3: drop old table and rename
DROP TABLE leaderboard_rankings;
ALTER TABLE leaderboard_rankings_new RENAME TO leaderboard_rankings;

-- Step 4: recreate indexes
CREATE INDEX IF NOT EXISTS idx_leaderboard_date_type ON leaderboard_rankings(snapshot_date, list_type);
