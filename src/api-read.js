/**
 * Read API handlers — served to the frontend
 */

/** GET /api/papers?date=YYYY-MM-DD&category=cs.AI&limit=50&offset=0&sort=composite&tag=finance&min_score=0 */
export async function handleGetPapers(request, env) {
    const url = new URL(request.url);
    const date = url.searchParams.get('date') || todayISO();
    const category = url.searchParams.get('category') || null;
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const sort = url.searchParams.get('sort') || 'composite';
    const tag = url.searchParams.get('tag') || null;
    const minScore = parseFloat(url.searchParams.get('min_score') || '0');

    const sortColumn = {
        composite: 'dr.composite_score',
        recency: 'p.published_date',
        citations: 'm.citation_velocity',
        altmetric: 'm.altmetric_score'
    }[sort] || 'dr.composite_score';

    let query = `
        SELECT
            p.id, p.arxiv_id, p.title, p.authors, p.published_date,
            p.categories, p.primary_category, p.pdf_url,
            m.citation_count, m.citation_velocity, m.altmetric_score,
            m.composite_score, m.factor_breakdown, m.fields_of_study,
            s.tldr, s.so_what, s.tags, s.difficulty,
            dr.rank
        FROM daily_rankings dr
        JOIN papers p ON dr.paper_id = p.id
        LEFT JOIN metrics m ON m.paper_id = p.id
        LEFT JOIN summaries s ON s.paper_id = p.id
        WHERE dr.digest_date = ?
          AND dr.composite_score >= ?
    `;
    const params = [date, minScore];

    if (category) {
        query += ` AND p.categories LIKE ?`;
        params.push(`%${category}%`);
    }
    if (tag) {
        query += ` AND s.tags LIKE ?`;
        params.push(`%${tag}%`);
    }

    query += ` ORDER BY ${sortColumn} DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const result = await env.DB.prepare(query).bind(...params).all();
    const papers = result.results.map(parsePaperRow);

    // Count total for pagination
    let countQuery = `
        SELECT COUNT(*) as total FROM daily_rankings dr
        JOIN papers p ON dr.paper_id = p.id
        LEFT JOIN summaries s ON s.paper_id = p.id
        WHERE dr.digest_date = ? AND dr.composite_score >= ?
    `;
    const countParams = [date, minScore];
    if (category) { countQuery += ` AND p.categories LIKE ?`; countParams.push(`%${category}%`); }
    if (tag) { countQuery += ` AND s.tags LIKE ?`; countParams.push(`%${tag}%`); }
    const countResult = await env.DB.prepare(countQuery).bind(...countParams).first();

    return jsonResponse({ papers, total: countResult.total, date, limit, offset });
}

/** GET /api/papers/:id */
export async function handleGetPaper(env, id) {
    const paper = await env.DB.prepare(`
        SELECT
            p.*, m.citation_count, m.citation_velocity, m.influential_citations,
            m.altmetric_score, m.news_count, m.twitter_count, m.patent_count,
            m.wikipedia_count, m.fields_of_study, m.openalex_concepts,
            m.h_index_avg, m.composite_score, m.factor_breakdown,
            s.tldr, s.so_what, s.tags, s.difficulty
        FROM papers p
        LEFT JOIN metrics m ON m.paper_id = p.id
        LEFT JOIN summaries s ON s.paper_id = p.id
        WHERE p.id = ?
    `).bind(id).first();

    if (!paper) return new Response('Not Found', { status: 404 });

    // Related papers: same primary category, different paper, recent
    const related = await env.DB.prepare(`
        SELECT p.id, p.title, p.primary_category, p.published_date, m.composite_score
        FROM papers p
        LEFT JOIN metrics m ON m.paper_id = p.id
        WHERE p.primary_category = ? AND p.id != ?
        ORDER BY m.composite_score DESC
        LIMIT 5
    `).bind(paper.primary_category, id).all();

    return jsonResponse({
        ...parsePaperRow(paper),
        abstract: paper.abstract,
        doi: paper.doi,
        updated_date: paper.updated_date,
        news_count: paper.news_count,
        twitter_count: paper.twitter_count,
        patent_count: paper.patent_count,
        wikipedia_count: paper.wikipedia_count,
        influential_citations: paper.influential_citations,
        openalex_concepts: tryParseJSON(paper.openalex_concepts, []),
        related: related.results.map(r => ({
            id: r.id,
            title: r.title,
            category: r.primary_category,
            published_date: r.published_date,
            composite_score: r.composite_score
        }))
    });
}

/** GET /api/search?q=keyword&limit=20&offset=0 */
export async function handleSearch(request, env) {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') || '';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    if (!q.trim()) return jsonResponse({ papers: [], total: 0 });

    const pattern = `%${q.trim()}%`;
    const result = await env.DB.prepare(`
        SELECT
            p.id, p.arxiv_id, p.title, p.authors, p.published_date,
            p.categories, p.primary_category, p.pdf_url,
            m.citation_count, m.citation_velocity, m.altmetric_score,
            m.composite_score, m.factor_breakdown, m.fields_of_study,
            s.tldr, s.so_what, s.tags, s.difficulty
        FROM papers p
        LEFT JOIN metrics m ON m.paper_id = p.id
        LEFT JOIN summaries s ON s.paper_id = p.id
        WHERE p.title LIKE ? OR p.abstract LIKE ?
        ORDER BY m.composite_score DESC
        LIMIT ? OFFSET ?
    `).bind(pattern, pattern, limit, offset).all();

    return jsonResponse({ papers: result.results.map(parsePaperRow), q });
}

/** GET /api/trends?period=7d */
export async function handleGetTrends(request, env) {
    const url = new URL(request.url);
    const period = url.searchParams.get('period') || '7d';
    const days = period === '30d' ? 30 : 7;
    const since = daysAgoISO(days);

    // Top categories by paper count and avg score
    const categories = await env.DB.prepare(`
        SELECT
            p.primary_category as category,
            COUNT(*) as paper_count,
            AVG(m.composite_score) as avg_score,
            MAX(m.composite_score) as max_score
        FROM papers p
        LEFT JOIN metrics m ON m.paper_id = p.id
        WHERE p.published_date >= ?
        GROUP BY p.primary_category
        ORDER BY avg_score DESC
        LIMIT 15
    `).bind(since).all();

    // Top papers over the period
    const topPapers = await env.DB.prepare(`
        SELECT
            p.id, p.title, p.primary_category, p.published_date,
            m.composite_score, m.citation_velocity,
            s.tldr, s.tags
        FROM papers p
        LEFT JOIN metrics m ON m.paper_id = p.id
        LEFT JOIN summaries s ON s.paper_id = p.id
        WHERE p.published_date >= ?
        ORDER BY m.composite_score DESC
        LIMIT 10
    `).bind(since).all();

    // Rising stars: high citation velocity, published in last 7 days
    const rising = await env.DB.prepare(`
        SELECT
            p.id, p.title, p.primary_category, p.published_date,
            m.citation_velocity, m.composite_score, s.tldr
        FROM papers p
        LEFT JOIN metrics m ON m.paper_id = p.id
        LEFT JOIN summaries s ON s.paper_id = p.id
        WHERE p.published_date >= ?
          AND m.citation_velocity > 0
        ORDER BY m.citation_velocity DESC
        LIMIT 10
    `).bind(daysAgoISO(7)).all();

    return jsonResponse({
        period,
        categories: categories.results,
        top_papers: topPapers.results.map(p => ({
            ...p,
            tags: tryParseJSON(p.tags, [])
        })),
        rising_stars: rising.results
    });
}

/** GET /api/categories */
export async function handleGetCategories(env) {
    const result = await env.DB.prepare(`
        SELECT primary_category, COUNT(*) as count
        FROM papers
        GROUP BY primary_category
        ORDER BY count DESC
    `).all();
    return jsonResponse({ categories: result.results });
}

/** GET /api/stats */
export async function handleGetStats(env) {
    const totalPapers = await env.DB.prepare('SELECT COUNT(*) as n FROM papers').first();
    const lastRun = await env.DB.prepare(
        'SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 1'
    ).first();
    const todayCount = await env.DB.prepare(
        'SELECT COUNT(*) as n FROM daily_rankings WHERE digest_date = ?'
    ).bind(todayISO()).first();
    const availableDates = await env.DB.prepare(
        'SELECT DISTINCT digest_date FROM daily_rankings ORDER BY digest_date DESC LIMIT 30'
    ).all();

    return jsonResponse({
        total_papers: totalPapers.n,
        today_ranked: todayCount.n,
        available_dates: availableDates.results.map(r => r.digest_date),
        last_pipeline_run: lastRun ? {
            started_at: lastRun.started_at,
            completed_at: lastRun.completed_at,
            status: lastRun.status,
            papers_fetched: lastRun.papers_fetched,
            papers_scored: lastRun.papers_scored,
            papers_summarized: lastRun.papers_summarized
        } : null
    });
}

// --- helpers ---

function parsePaperRow(row) {
    return {
        id: row.id,
        arxiv_id: row.arxiv_id,
        title: row.title,
        authors: tryParseJSON(row.authors, []),
        published_date: row.published_date,
        categories: tryParseJSON(row.categories, []),
        primary_category: row.primary_category,
        pdf_url: row.pdf_url,
        citation_count: row.citation_count,
        citation_velocity: row.citation_velocity,
        altmetric_score: row.altmetric_score,
        composite_score: row.composite_score,
        factor_breakdown: tryParseJSON(row.factor_breakdown, {}),
        fields_of_study: tryParseJSON(row.fields_of_study, []),
        tldr: row.tldr,
        so_what: row.so_what,
        tags: tryParseJSON(row.tags, []),
        difficulty: row.difficulty,
        rank: row.rank
    };
}

function tryParseJSON(str, fallback) {
    try { return str ? JSON.parse(str) : fallback; }
    catch { return fallback; }
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
}
