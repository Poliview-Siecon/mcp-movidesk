// Normalização do texto das ações (trâmites) para HTML.
//
// O Movidesk renderiza o trâmite como HTML. Texto puro com "\n" aparece
// colado, sem quebras de linha nem parágrafos. Por isso, toda `description`
// de ação que não contenha marcação HTML é convertida aqui: o texto é
// escapado, linhas em branco viram parágrafos (<p>) e quebras simples viram
// <br>. Texto que já contém tags HTML é enviado sem alteração.

const HTML_TAG = /<\/?[a-z][a-z0-9]*(\s[^>]*)?\/?>/i;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function toHtml(text: string): string {
  if (HTML_TAG.test(text)) {
    return text;
  }

  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (normalized === '') {
    return text;
  }

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function normalizeActionsToHtml(actions: unknown): unknown {
  if (!Array.isArray(actions)) {
    return actions;
  }

  return actions.map((action) => {
    if (typeof action !== 'object' || action === null) {
      return action;
    }

    const { description } = action as { description?: unknown };
    if (typeof description !== 'string') {
      return action;
    }

    return { ...action, description: toHtml(description) };
  });
}
