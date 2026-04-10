/**
 * Cloudflare Worker for Research Papers Discovery Engine
 * Read API: served to the frontend (public)
 * Write API: served to the Python pipeline (requires X-Pipeline-Key)
 */

import { corsHeaders, handleOptions } from './cors.js';
import {
    handleGetPapers,
    handleGetPaper,
    handleSearch,
    handleGetTrends,
    handleGetCategories,
    handleGetStats
} from './api-read.js';
import {
    validatePipelineKey,
    handleIngestPapers,
    handleIngestSummaries,
    handleIngestMetrics,
    handleIngestDigest,
    handlePipelineStatus
} from './api-write.js';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return handleOptions(request, env);
        }

        try {
            // --- Read endpoints (public) ---

            if (url.pathname === '/health') {
                return new Response(
                    JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }),
                    { status: 200, headers: { ...corsHeaders(request, env), 'Content-Type': 'application/json' } }
                );
            }

            if (url.pathname === '/api/papers' && request.method === 'GET') {
                return withCors(await handleGetPapers(request, env), request, env);
            }

            // GET /api/papers/:id
            const paperMatch = url.pathname.match(/^\/api\/papers\/([^/]+)$/);
            if (paperMatch && request.method === 'GET') {
                return withCors(await handleGetPaper(env, paperMatch[1]), request, env);
            }

            if (url.pathname === '/api/search' && request.method === 'GET') {
                return withCors(await handleSearch(request, env), request, env);
            }

            if (url.pathname === '/api/trends' && request.method === 'GET') {
                return withCors(await handleGetTrends(request, env), request, env);
            }

            if (url.pathname === '/api/categories' && request.method === 'GET') {
                return withCors(await handleGetCategories(env), request, env);
            }

            if (url.pathname === '/api/stats' && request.method === 'GET') {
                return withCors(await handleGetStats(env), request, env);
            }

            // --- Trigger endpoint (requires X-Pipeline-Key) ---

            if (url.pathname === '/api/trigger' && request.method === 'POST') {
                const authError = validatePipelineKey(request, env);
                if (authError) return withCors(authError, request, env);
                return withCors(await handleTrigger(env), request, env);
            }

            // --- Write endpoints (pipeline only) ---

            if (url.pathname.startsWith('/api/ingest/') || url.pathname === '/api/pipeline/status') {
                const authError = validatePipelineKey(request, env);
                if (authError) return withCors(authError, request, env);

                if (url.pathname === '/api/ingest/papers' && request.method === 'POST') {
                    return withCors(await handleIngestPapers(request, env), request, env);
                }
                if (url.pathname === '/api/ingest/summaries' && request.method === 'POST') {
                    return withCors(await handleIngestSummaries(request, env), request, env);
                }
                if (url.pathname === '/api/ingest/metrics' && request.method === 'POST') {
                    return withCors(await handleIngestMetrics(request, env), request, env);
                }
                if (url.pathname === '/api/ingest/digest' && request.method === 'POST') {
                    return withCors(await handleIngestDigest(request, env), request, env);
                }
                if (url.pathname === '/api/pipeline/status' && request.method === 'POST') {
                    return withCors(await handlePipelineStatus(request, env), request, env);
                }
            }

            return withCors(
                new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }),
                request, env
            );

        } catch (error) {
            console.error('Worker error:', error.message, error.stack);
            return withCors(
                new Response(
                    JSON.stringify({ error: error.message || 'Internal server error' }),
                    { status: 500, headers: { 'Content-Type': 'application/json' } }
                ),
                request, env
            );
        }
    }
};

async function handleTrigger(env) {
    if (!env.GITHUB_TOKEN) {
        return new Response(JSON.stringify({ error: 'GITHUB_TOKEN not configured' }), {
            status: 503, headers: { 'Content-Type': 'application/json' }
        });
    }

    const resp = await fetch(
        'https://api.github.com/repos/thomasrribeiro/research-papers/actions/workflows/pipeline.yml/dispatches',
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
                'User-Agent': 'research-papers-worker'
            },
            body: JSON.stringify({ ref: 'master' })
        }
    );

    // GitHub returns 204 No Content on success
    if (resp.status === 204) {
        return new Response(JSON.stringify({ ok: true, message: 'Pipeline triggered' }), {
            status: 200, headers: { 'Content-Type': 'application/json' }
        });
    }

    const body = await resp.text();
    return new Response(JSON.stringify({ error: `GitHub API error ${resp.status}`, detail: body }), {
        status: 502, headers: { 'Content-Type': 'application/json' }
    });
}

function withCors(response, request, env) {
    const headers = corsHeaders(request, env);
    const newHeaders = new Headers(response.headers);
    for (const [k, v] of Object.entries(headers)) {
        newHeaders.set(k, v);
    }
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
    });
}
