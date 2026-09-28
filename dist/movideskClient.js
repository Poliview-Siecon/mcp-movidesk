import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
const BASE_URL = 'https://api.movidesk.com/public/v1';
function parseCliArgs() {
    const args = new Map();
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) {
            continue;
        }
        const eqIndex = arg.indexOf('=');
        if (eqIndex !== -1) {
            args.set(arg.slice(2, eqIndex), arg.slice(eqIndex + 1));
            continue;
        }
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
            args.set(key, next);
            i++;
        }
        else {
            args.set(key, 'true');
        }
    }
    return args;
}
function getToken() {
    const cliArgs = parseCliArgs();
    const token = cliArgs.get('token') ?? process.env.MOVIDESK_TOKEN;
    if (!token) {
        throw new Error('Token de autenticação obrigatório: defina a variável de ambiente MOVIDESK_TOKEN ou passe --token=<valor>');
    }
    return token;
}
const token = getToken();
function buildQueryString(params = {}) {
    const searchParams = new URLSearchParams();
    searchParams.set('token', token);
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) {
            continue;
        }
        searchParams.set(key, String(value));
    }
    return searchParams.toString();
}
export class MovideskApiError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = 'MovideskApiError';
    }
}
async function parseErrorBody(response) {
    const text = await response.text();
    if (!text) {
        return `HTTP ${response.status}`;
    }
    try {
        const json = JSON.parse(text);
        return typeof json === 'string' ? json : JSON.stringify(json);
    }
    catch {
        return text;
    }
}
async function ensureOk(response) {
    if (response.ok) {
        return;
    }
    if (response.status === 429) {
        throw new MovideskApiError(429, 'Limite de requisições por minuto da API do Movidesk foi atingido (429). Aguarde antes de tentar novamente.');
    }
    const detail = await parseErrorBody(response);
    throw new MovideskApiError(response.status, `Erro na API do Movidesk (HTTP ${response.status}): ${detail}`);
}
async function handleResponse(response) {
    await ensureOk(response);
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined);
}
export async function get(path, params) {
    const url = `${BASE_URL}${path}?${buildQueryString(params)}`;
    const response = await fetch(url);
    return handleResponse(response);
}
export async function post(path, body, params) {
    const url = `${BASE_URL}${path}?${buildQueryString(params)}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return handleResponse(response);
}
export async function patch(path, body, params) {
    const url = `${BASE_URL}${path}?${buildQueryString(params)}`;
    const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return handleResponse(response);
}
export async function uploadFile(path, filePath, params) {
    let fileContent;
    try {
        fileContent = await readFile(filePath);
    }
    catch {
        throw new Error(`Arquivo não encontrado: ${filePath}`);
    }
    const formData = new FormData();
    formData.append('anexos', new Blob([fileContent]), basename(filePath));
    const url = `${BASE_URL}${path}?${buildQueryString(params)}`;
    const response = await fetch(url, {
        method: 'POST',
        body: formData,
    });
    return handleResponse(response);
}
// Extrai o nome do arquivo de Content-Disposition, priorizando filename*
// (RFC 5987, UTF-8) sobre filename.
export function parseContentDispositionFileName(header) {
    if (!header) {
        return undefined;
    }
    const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
    if (extended) {
        try {
            return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''));
        }
        catch {
            // cai para filename simples
        }
    }
    const simple = /filename\s*=\s*("([^"]*)"|[^;]+)/.exec(header);
    if (simple) {
        return (simple[2] ?? simple[1]).trim() || undefined;
    }
    return undefined;
}
export async function downloadFile(path, params) {
    const url = `${BASE_URL}${path}?${buildQueryString(params)}`;
    const response = await fetch(url);
    await ensureOk(response);
    const content = Buffer.from(await response.arrayBuffer());
    return {
        content,
        contentType: response.headers.get('content-type') ?? undefined,
        fileName: parseContentDispositionFileName(response.headers.get('content-disposition')),
    };
}
//# sourceMappingURL=movideskClient.js.map