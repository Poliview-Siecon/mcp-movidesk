import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MOVIDESK_TOKEN = 'test-token';

const { handleDownloadAttachment, sanitizeFileName, resolveMimeType, MAX_INLINE_BYTES } = await import(
  '../src/downloadAttachmentHandler.js'
);
const { parseContentDispositionFileName } = await import('../src/movideskClient.js');

const HASH = 'BF05F001CDD62AE70C623F10E8DE8D8A';

function binaryResponse(status: number, body: Buffer | string, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : new Uint8Array(body), { status, headers });
}

async function withFetch<T>(impl: (url: string) => Response, fn: (calls: string[]) => Promise<T>): Promise<T> {
  const originalFetch = global.fetch;
  const calls: string[] = [];
  global.fetch = (async (url: string) => {
    calls.push(url);
    return impl(url);
  }) as unknown as typeof fetch;

  try {
    return await fn(calls);
  } finally {
    global.fetch = originalFetch;
  }
}

test('hash inválido não chama a API', async () => {
  await withFetch(
    () => binaryResponse(200, ''),
    async (calls) => {
      const result = await handleDownloadAttachment({ path: '../etc/passwd' });
      assert.equal(result.isError, true);
      assert.equal(calls.length, 0);
    }
  );
});

test('chama /storage/download com o hash e o token na query', async () => {
  await withFetch(
    () => binaryResponse(200, 'conteúdo', { 'content-type': 'text/plain; charset=utf-8' }),
    async (calls) => {
      const result = await handleDownloadAttachment({ path: HASH, fileName: 'log.txt' });
      assert.equal(result.isError, undefined);
      assert.match(calls[0], /\/storage\/download\?/);
      assert.match(calls[0], new RegExp(`id=${HASH}(&|$)`));
      assert.match(calls[0], /token=test-token/);
      assert.deepEqual(result.content[1], { type: 'text', text: 'conteúdo' });
    }
  );
});

test('imagem é retornada como conteúdo image em base64', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  await withFetch(
    () => binaryResponse(200, png, { 'content-type': 'application/octet-stream' }),
    async () => {
      const result = await handleDownloadAttachment({ path: HASH, fileName: 'print.png' });
      const image = result.content[1];
      assert.equal(image.type, 'image');
      if (image.type === 'image') {
        assert.equal(image.mimeType, 'image/png');
        assert.equal(image.data, png.toString('base64'));
      }
    }
  );
});

test('binário genérico é retornado como resource blob', async () => {
  await withFetch(
    () =>
      binaryResponse(200, Buffer.from([1, 2, 3]), {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="pacote.zip"',
      }),
    async () => {
      const result = await handleDownloadAttachment({ path: HASH });
      const block = result.content[1];
      assert.equal(block.type, 'resource');
      if (block.type === 'resource') {
        assert.equal(block.resource.mimeType, 'application/zip');
        assert.equal(block.resource.blob, Buffer.from([1, 2, 3]).toString('base64'));
        assert.match(block.resource.uri, /pacote\.zip$/);
      }
    }
  );
});

test('conteúdo acima do limite inline exige destinationPath', async () => {
  await withFetch(
    () => binaryResponse(200, Buffer.alloc(MAX_INLINE_BYTES + 1), { 'content-type': 'application/pdf' }),
    async () => {
      const result = await handleDownloadAttachment({ path: HASH, fileName: 'grande.pdf' });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /destinationPath/);
    }
  );
});

test('salva no diretório informado e não sobrescreve sem overwrite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-movidesk-'));
  try {
    await withFetch(
      () => binaryResponse(200, 'abc', { 'content-type': 'text/plain' }),
      async () => {
        const first = await handleDownloadAttachment({ path: HASH, fileName: '../../fora.txt', destinationPath: dir });
        assert.equal(first.isError, undefined);
        assert.equal(await readFile(join(dir, 'fora.txt'), 'utf-8'), 'abc');

        const second = await handleDownloadAttachment({ path: HASH, fileName: 'fora.txt', destinationPath: dir });
        assert.equal(second.isError, true);
        assert.match(JSON.stringify(second.content), /overwrite=true/);

        await writeFile(join(dir, 'fora.txt'), 'antigo');
        const third = await handleDownloadAttachment({
          path: HASH,
          fileName: 'fora.txt',
          destinationPath: dir,
          overwrite: true,
        });
        assert.equal(third.isError, undefined);
        assert.equal(await readFile(join(dir, 'fora.txt'), 'utf-8'), 'abc');
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('404 da API é propagado como erro', async () => {
  await withFetch(
    () => binaryResponse(404, ''),
    async () => {
      await assert.rejects(handleDownloadAttachment({ path: HASH }), /HTTP 404/);
    }
  );
});

test('sanitizeFileName remove diretórios e caracteres inválidos', () => {
  assert.equal(sanitizeFileName('..\\..\\a:b?.txt'), 'a_b_.txt');
  assert.equal(sanitizeFileName('../'), '');
  assert.equal(sanitizeFileName('..'), '');
});

test('resolveMimeType usa extensão quando o content-type é genérico', () => {
  assert.equal(resolveMimeType('application/octet-stream', 'x.JPG'), 'image/jpeg');
  assert.equal(resolveMimeType('application/pdf; charset=binary', 'x.bin'), 'application/pdf');
  assert.equal(resolveMimeType(undefined, 'x.unknown'), 'application/octet-stream');
});

test('parseContentDispositionFileName prioriza filename*', () => {
  assert.equal(
    parseContentDispositionFileName(`attachment; filename="a.txt"; filename*=UTF-8''relat%C3%B3rio.pdf`),
    'relatório.pdf'
  );
  assert.equal(parseContentDispositionFileName('attachment; filename=b.txt'), 'b.txt');
  assert.equal(parseContentDispositionFileName(null), undefined);
});
