import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MOVIDESK_TOKEN = 'test-token';

const { toHtml, normalizeActionsToHtml } = await import('../src/ticketHtml.js');
const { mergeTags, mergeCustomFieldValues } = await import('../src/ticketMerge.js');
const { handleUpdateTicket } = await import('../src/updateTicketHandler.js');
const { handleCreateTicket } = await import('../src/createTicketHandler.js');

type FakeResponse = { ok: boolean; status: number; text: () => Promise<string> };

function fakeResponse(status: number, body: unknown): FakeResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

test('texto puro vira parágrafos e <br>', () => {
  assert.equal(toHtml('linha 1\nlinha 2\n\nsegundo parágrafo'), '<p>linha 1<br>linha 2</p><p>segundo parágrafo</p>');
});

test('texto puro tem <, > e & escapados', () => {
  assert.equal(toHtml('a < b & c > d'), '<p>a &lt; b &amp; c &gt; d</p>');
});

test('texto com HTML é preservado', () => {
  assert.equal(toHtml('<p>já <b>html</b></p>'), '<p>já <b>html</b></p>');
});

test('normalizeActionsToHtml converte só description de texto', () => {
  const result = normalizeActionsToHtml([
    { id: 0, type: 1, description: 'nota\nsimples' },
    { id: 2, type: 1 },
  ]);
  assert.deepEqual(result, [
    { id: 0, type: 1, description: '<p>nota<br>simples</p>' },
    { id: 2, type: 1 },
  ]);
});

test('mergeTags acrescenta sem duplicar', () => {
  assert.deepEqual(mergeTags(['a', 'B'], ['b', 'c']), ['a', 'B', 'c']);
});

test('mergeCustomFieldValues preserva existentes e substitui pela chave', () => {
  const existing = [
    { customFieldId: 1, customFieldRuleId: 10, line: 1, items: [{ customFieldItem: 'velho' }] },
    { customFieldId: 2, customFieldRuleId: 20, line: 1, items: [{ customFieldItem: 'fica' }] },
  ];
  const incoming = [{ customFieldId: 1, customFieldRuleId: 10, line: 1, items: [{ customFieldItem: 'novo' }] }];
  assert.deepEqual(mergeCustomFieldValues(existing, incoming), [existing[1], incoming[0]]);
});

test('update_ticket mescla tags e campos com o ticket atual antes do PATCH', async () => {
  const originalFetch = global.fetch;
  const calls: { method: string; body?: string }[] = [];
  global.fetch = (async (_url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', body: init?.body as string | undefined });
    if (!init?.method || init.method === 'GET') {
      return fakeResponse(200, {
        tags: ['cotacaoweb'],
        customFieldValues: [{ customFieldId: 2, customFieldRuleId: 20, line: 1, items: [] }],
      });
    }
    return fakeResponse(200, {});
  }) as unknown as typeof fetch;

  try {
    await handleUpdateTicket({
      id: 1,
      tags: ['nova'],
      customFieldValues: [{ customFieldId: 1, customFieldRuleId: 10, line: 1, items: [] }],
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'GET');
    const sent = JSON.parse(calls[1].body ?? '{}');
    assert.deepEqual(sent.tags, ['cotacaoweb', 'nova']);
    assert.equal(sent.customFieldValues.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('update_ticket com replaceTags não lê o ticket e envia só as tags informadas', async () => {
  const originalFetch = global.fetch;
  const calls: { method: string; body?: string }[] = [];
  global.fetch = (async (_url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', body: init?.body as string | undefined });
    return fakeResponse(200, {});
  }) as unknown as typeof fetch;

  try {
    await handleUpdateTicket({ id: 1, tags: ['so-esta'], replaceTags: true });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PATCH');
    assert.deepEqual(JSON.parse(calls[0].body ?? '{}'), { tags: ['so-esta'] });
  } finally {
    global.fetch = originalFetch;
  }
});

test('update_ticket com status sem justification envia justification vazia', async () => {
  const originalFetch = global.fetch;
  const bodies: string[] = [];
  global.fetch = (async (_url: string, init?: RequestInit) => {
    bodies.push(init?.body as string);
    return fakeResponse(200, {});
  }) as unknown as typeof fetch;

  try {
    await handleUpdateTicket({ id: 1, status: 'Resolvido' });
    await handleUpdateTicket({ id: 1, status: 'Aguardando', justification: 'Retorno do cliente' });
    await handleUpdateTicket({ id: 1, subject: 'sem status' });

    assert.deepEqual(JSON.parse(bodies[0]), { status: 'Resolvido', justification: '' });
    assert.deepEqual(JSON.parse(bodies[1]), { status: 'Aguardando', justification: 'Retorno do cliente' });
    assert.deepEqual(JSON.parse(bodies[2]), { subject: 'sem status' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('create_ticket e update_ticket enviam description de ação em HTML', async () => {
  const originalFetch = global.fetch;
  const bodies: string[] = [];
  global.fetch = (async (_url: string, init?: RequestInit) => {
    bodies.push(init?.body as string);
    return fakeResponse(200, {});
  }) as unknown as typeof fetch;

  try {
    await handleCreateTicket({
      type: 1,
      subject: 's',
      createdBy: { id: '1' },
      clients: [{ id: '1' }],
      actions: [{ id: 0, type: 1, description: 'a\nb', createdBy: { id: '1' } }],
    });
    await handleUpdateTicket({ id: 1, actions: [{ id: 1, type: 1, description: 'x\ny' }] });

    assert.equal(JSON.parse(bodies[0]).actions[0].description, '<p>a<br>b</p>');
    assert.equal(JSON.parse(bodies[1]).actions[0].description, '<p>x<br>y</p>');
  } finally {
    global.fetch = originalFetch;
  }
});
