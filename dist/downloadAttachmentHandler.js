import { stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import * as movidesk from './movideskClient.js';
import { toError } from './toolResult.js';
// Acima deste tamanho o conteúdo não é devolvido inline (base64 no resultado
// da tool consome contexto do modelo); o chamador deve informar destinationPath.
export const MAX_INLINE_BYTES = 5 * 1024 * 1024;
// O "path" retornado em actions[].attachments[] é um hash (ex.: 32 caracteres
// hexadecimais). A validação é deliberadamente mais ampla que hex para não
// rejeitar formatos que a documentação não detalha.
const ATTACHMENT_HASH_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MIME_BY_EXTENSION = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.log': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.html': 'text/html',
};
const GENERIC_CONTENT_TYPES = new Set(['application/octet-stream', 'binary/octet-stream']);
// Remove componentes de diretório e caracteres inválidos em nomes de arquivo
// (Windows/Unix), evitando path traversal a partir de nomes vindos da API.
export function sanitizeFileName(name) {
    const base = basename(name.replace(/\\/g, '/'));
    const cleaned = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+$/, '').trim();
    return cleaned;
}
export function resolveMimeType(contentType, fileName) {
    const normalized = contentType?.split(';')[0].trim().toLowerCase();
    if (normalized && !GENERIC_CONTENT_TYPES.has(normalized)) {
        return normalized;
    }
    return MIME_BY_EXTENSION[extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}
function isTextMimeType(mimeType) {
    return (mimeType.startsWith('text/') ||
        mimeType === 'application/json' ||
        mimeType === 'application/xml' ||
        mimeType.endsWith('+json') ||
        mimeType.endsWith('+xml'));
}
async function resolveTargetFile(destinationPath, fileName) {
    const target = resolve(destinationPath);
    try {
        const info = await stat(target);
        if (info.isDirectory()) {
            return join(target, fileName);
        }
    }
    catch {
        // não existe: tratado como caminho completo do arquivo
    }
    return target;
}
export async function handleDownloadAttachment(params) {
    const { path, fileName, destinationPath, overwrite } = params;
    if (typeof path !== 'string' || !ATTACHMENT_HASH_PATTERN.test(path)) {
        return toError('"path" é obrigatório e deve ser o hash do anexo (campo "path" em actions[].attachments[] retornado por get_ticket).');
    }
    if (fileName !== undefined && typeof fileName !== 'string') {
        return toError('"fileName" deve ser uma string.');
    }
    if (destinationPath !== undefined && (typeof destinationPath !== 'string' || !destinationPath.trim())) {
        return toError('"destinationPath" deve ser um caminho não vazio.');
    }
    const file = await movidesk.downloadFile('/storage/download', { id: path });
    const name = sanitizeFileName(fileName ?? file.fileName ?? '') || path;
    const mimeType = resolveMimeType(file.contentType, name);
    const metadata = { path, fileName: name, mimeType, size: file.content.length };
    if (destinationPath !== undefined) {
        const target = await resolveTargetFile(destinationPath, name);
        try {
            await writeFile(target, file.content, { flag: overwrite === true ? 'w' : 'wx' });
        }
        catch (error) {
            const code = error.code;
            if (code === 'EEXIST') {
                return toError(`O arquivo já existe: ${target}. Use overwrite=true para sobrescrever.`);
            }
            if (code === 'ENOENT') {
                return toError(`Diretório de destino não encontrado: ${target}`);
            }
            throw error;
        }
        return { content: [{ type: 'text', text: JSON.stringify({ ...metadata, savedTo: target }, null, 2) }] };
    }
    if (file.content.length > MAX_INLINE_BYTES) {
        return toError(`Anexo com ${file.content.length} bytes excede o limite de ${MAX_INLINE_BYTES} bytes para retorno inline. Informe "destinationPath" para salvar em disco.`);
    }
    const metadataBlock = { type: 'text', text: JSON.stringify(metadata, null, 2) };
    if (mimeType.startsWith('image/')) {
        return {
            content: [metadataBlock, { type: 'image', data: file.content.toString('base64'), mimeType }],
        };
    }
    if (isTextMimeType(mimeType)) {
        return { content: [metadataBlock, { type: 'text', text: file.content.toString('utf-8') }] };
    }
    return {
        content: [
            metadataBlock,
            {
                type: 'resource',
                resource: {
                    uri: `movidesk://attachments/${encodeURIComponent(path)}/${encodeURIComponent(name)}`,
                    mimeType,
                    blob: file.content.toString('base64'),
                },
            },
        ],
    };
}
//# sourceMappingURL=downloadAttachmentHandler.js.map