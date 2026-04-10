/**
 * CORS configuration and handlers
 */

export function corsHeaders(request, env) {
    const origin = request ? request.headers.get('Origin') : null;
    const allowedOrigins = env.ALLOWED_ORIGINS
        ? env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
        : ['http://localhost:3000', 'http://localhost:5173'];

    const allowedOrigin = allowedOrigins.includes(origin)
        ? origin
        : allowedOrigins[0];

    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Pipeline-Key',
        'Access-Control-Max-Age': '86400'
    };
}

export function handleOptions(request, env) {
    return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env)
    });
}
