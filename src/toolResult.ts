export type TextContent = { type: 'text'; text: string };
export type ImageContent = { type: 'image'; data: string; mimeType: string };
export type EmbeddedResourceContent = {
  type: 'resource';
  resource: { uri: string; mimeType?: string; blob: string };
};

export type ContentBlock = TextContent | ImageContent | EmbeddedResourceContent;

export type ToolResult<C extends ContentBlock = TextContent> = {
  content: C[];
  isError?: boolean;
};

export function toText(result: unknown): ToolResult {
  const text = result === undefined ? 'OK (resposta sem corpo)' : JSON.stringify(result, null, 2);
  return { content: [{ type: 'text', text }] };
}

export function toError(message: string): ToolResult {
  return { content: [{ type: 'text', text: `Erro: ${message}` }], isError: true };
}
