import * as movidesk from './movideskClient.js';
import { validateCreateTicketPayload } from './createTicketValidation.js';
import { normalizeActionsToHtml } from './ticketHtml.js';
import { type ToolResult, toText, toError } from './toolResult.js';

export async function handleCreateTicket(params: Record<string, unknown>): Promise<ToolResult> {
  const validation = validateCreateTicketPayload(params);
  if (!validation.ok) {
    return toError(validation.message);
  }

  const payload = 'actions' in params ? { ...params, actions: normalizeActionsToHtml(params.actions) } : params;
  const result = await movidesk.post('/tickets', payload);
  return toText(result);
}
