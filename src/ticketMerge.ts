// Mescla de `tags` e `customFieldValues` no update_ticket.
//
// A API do Movidesk SUBSTITUI a lista inteira quando `tags` ou
// `customFieldValues` são enviados em PATCH: o que não vier no payload é
// apagado do ticket. Para o chamador não perder dados sem perceber, o MCP lê
// o ticket atual e mescla antes de enviar. Quem quiser realmente substituir
// (ex.: remover uma tag) usa `replaceTags` / `replaceCustomFieldValues`.

type CustomFieldValue = {
  customFieldId?: unknown;
  customFieldRuleId?: unknown;
  line?: unknown;
};

function customFieldKey(value: CustomFieldValue): string {
  return `${String(value.customFieldId)}:${String(value.customFieldRuleId)}:${String(value.line)}`;
}

export function mergeTags(existing: unknown, incoming: string[]): string[] {
  const current = Array.isArray(existing) ? existing.filter((t): t is string => typeof t === 'string') : [];
  const merged = [...current];

  for (const tag of incoming) {
    if (!merged.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      merged.push(tag);
    }
  }

  return merged;
}

export function mergeCustomFieldValues(existing: unknown, incoming: CustomFieldValue[]): CustomFieldValue[] {
  const current = Array.isArray(existing) ? (existing as CustomFieldValue[]) : [];
  const incomingKeys = new Set(incoming.map(customFieldKey));

  return [...current.filter((value) => !incomingKeys.has(customFieldKey(value))), ...incoming];
}
