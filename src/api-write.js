/**
 * Write API handlers — called by the Python pipeline only.
 * All routes require a valid X-Pipeline-Key header.
 */

export function validatePipelineKey(request, env) {
    const key = request.headers.get('X-Pipeline-Key');
    if (!env.PIPELINE_API_KEY || key !== env.PIPELINE_API_KEY) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    return null; // null = valid
}

/** POST /api/ingest/papers — batch upsert papers */
export async function handleIngestPapers(request, env) {
    const { papers } = await request.json();
    if (!Array.isArray(papers) || papers.length === 0) {
        return jsonResponse({ inserted: 0 });
    }

    let inserted = 0;
    for (const p of papers) {
        await env.DB.prepare(`
            INSERT INTO papers (id, arxiv_id, doi, title, abstract, authors, published_date,
                updated_date, categories, primary_category, pdf_url, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                updated_date = excluded.updated_date,
                categories = excluded.categories
        `).bind(
            p.id, p.arxiv_id || p.id, p.doi || null,
            p.title, p.abstract,
            JSON.stringify(p.authors || []),
            p.published_date, p.updated_date || null,
            JSON.stringify(p.categories || []),
            p.primary_category,
            p.pdf_url || null,
            p.source || 'arxiv'
        ).run();
        inserted++;
    }

    return jsonResponse({ inserted });
}

/** POST /api/ingest/summaries — batch upsert AI summaries */
export async function handleIngestSummaries(request, env) {
    const { summaries } = await request.json();
    if (!Array.isArray(summaries) || summaries.length === 0) {
        return jsonResponse({ inserted: 0 });
    }

    let inserted = 0;
    for (const s of summaries) {
        await env.DB.prepare(`
            INSERT INTO summaries (paper_id, tldr, so_what, tags, difficulty, model)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(paper_id) DO UPDATE SET
                tldr = excluded.tldr,
                so_what = excluded.so_what,
                tags = excluded.tags,
                difficulty = excluded.difficulty,
                generated_at = datetime('now')
        `).bind(
            s.paper_id, s.tldr, s.so_what,
            JSON.stringify(s.tags || []),
            s.difficulty || 3,
            s.model || 'claude-sonnet-4-20250514'
        ).run();
        inserted++;
    }

    return jsonResponse({ inserted });
}

/** POST /api/ingest/metrics — batch upsert scoring metrics */
export async function handleIngestMetrics(request, env) {
    const { metrics } = await request.json();
    if (!Array.isArray(metrics) || metrics.length === 0) {
        return jsonResponse({ inserted: 0 });
    }

    let inserted = 0;
    for (const m of metrics) {
        await env.DB.prepare(`
            INSERT INTO metrics (
                paper_id, citation_count, citation_velocity, influential_citations,
                altmetric_score, news_count, twitter_count, patent_count, wikipedia_count,
                fields_of_study, openalex_concepts, h_index_avg,
                composite_score, factor_breakdown
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(paper_id) DO UPDATE SET
                citation_count = excluded.citation_count,
                citation_velocity = excluded.citation_velocity,
                influential_citations = excluded.influential_citations,
                altmetric_score = excluded.altmetric_score,
                news_count = excluded.news_count,
                twitter_count = excluded.twitter_count,
                patent_count = excluded.patent_count,
                wikipedia_count = excluded.wikipedia_count,
                fields_of_study = excluded.fields_of_study,
                openalex_concepts = excluded.openalex_concepts,
                h_index_avg = excluded.h_index_avg,
                composite_score = excluded.composite_score,
                factor_breakdown = excluded.factor_breakdown,
                scored_at = datetime('now')
        `).bind(
            m.paper_id,
            m.citation_count || 0, m.citation_velocity || 0, m.influential_citations || 0,
            m.altmetric_score || 0, m.news_count || 0, m.twitter_count || 0,
            m.patent_count || 0, m.wikipedia_count || 0,
            JSON.stringify(m.fields_of_study || []),
            JSON.stringify(m.openalex_concepts || []),
            m.h_index_avg || 0,
            m.composite_score || 0,
            JSON.stringify(m.factor_breakdown || {})
        ).run();
        inserted++;
    }

    return jsonResponse({ inserted });
}

/** POST /api/ingest/digest — create daily ranked digest */
export async function handleIngestDigest(request, env) {
    const { date, rankings } = await request.json();
    // rankings: [{paper_id, rank, composite_score}]
    if (!date || !Array.isArray(rankings)) {
        return jsonResponse({ error: 'Missing date or rankings' }, 400);
    }

    // Clear existing rankings for this date
    await env.DB.prepare('DELETE FROM daily_rankings WHERE digest_date = ?').bind(date).run();

    let inserted = 0;
    for (const r of rankings) {
        await env.DB.prepare(`
            INSERT INTO daily_rankings (digest_date, paper_id, rank, composite_score)
            VALUES (?, ?, ?, ?)
        `).bind(date, r.paper_id, r.rank, r.composite_score).run();
        inserted++;
    }

    return jsonResponse({ date, inserted });
}

/** POST /api/pipeline/status — log pipeline run */
export async function handlePipelineStatus(request, env) {
    const body = await request.json();

    if (body.action === 'start') {
        const result = await env.DB.prepare(`
            INSERT INTO pipeline_runs (started_at, status, stats)
            VALUES (datetime('now'), 'running', ?)
        `).bind(JSON.stringify(body.stats || {})).run();
        return jsonResponse({ run_id: result.meta.last_row_id });
    }

    if (body.action === 'complete' && body.run_id) {
        await env.DB.prepare(`
            UPDATE pipeline_runs
            SET completed_at = datetime('now'),
                status = ?,
                papers_fetched = ?,
                papers_scored = ?,
                papers_summarized = ?,
                error_message = ?,
                stats = ?
            WHERE id = ?
        `).bind(
            body.status || 'success',
            body.papers_fetched || 0,
            body.papers_scored || 0,
            body.papers_summarized || 0,
            body.error_message || null,
            JSON.stringify(body.stats || {}),
            body.run_id
        ).run();
        return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: 'Invalid action' }, 400);
}

// --- helpers ---

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
