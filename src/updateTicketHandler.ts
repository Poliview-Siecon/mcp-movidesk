import * as movidesk from './movideskClient.js';
import { validateUpdateTicketPayload } from './updateTicketValidation.js';
import { normalizeActionsToHtml } from './ticketHtml.js';
import { mergeTags, mergeCustomFieldValues } from './ticketMerge.js';
import { type ToolResult, toText, toError } from './toolResult.js';

type CurrentTicket = { tags?: unknown; customFieldValues?: unknown };

async function mergeWithCurrentTicket(
  id: number,
  ticket: Record<string, unknown>,
  replaceTags: boolean,
  replaceCustomFieldValues: boolean,
): Promise<Record<string, unknown>> {
  const mergeTagsNeeded = Array.isArray(ticket.tags) && !replaceTags;
  const mergeCustomFieldsNeeded = Array.isArray(ticket.customFieldValues) && !replaceCustomFieldValues;
  if (!mergeTagsNeeded && !mergeCustomFieldsNeeded) {
    return ticket;
  }

  const current = await movidesk.get<CurrentTicket>('/tickets', { id });
  const merged = { ...ticket };

  if (mergeTagsNeeded) {
    merged.tags = mergeTags(current.tags, ticket.tags as string[]);
  }

  if (mergeCustomFieldsNeeded) {
    merged.customFieldValues = mergeCustomFieldValues(
      current.customFieldValues,
      ticket.customFieldValues as Record<string, unknown>[],
    );
  }

  return merged;
}

export async function handleUpdateTicket(params: Record<string, unknown>): Promise<ToolResult> {
  const { id, replaceTags, replaceCustomFieldValues, ...ticket } = params as {
    id: number;
    replaceTags?: boolean;
    replaceCustomFieldValues?: boolean;
    [key: string]: unknown;
  };

  const validation = validateUpdateTicketPayload(ticket);
  if (!validation.ok) {
    return toError(validation.message);
  }

  const payload = await mergeWithCurrentTicket(id, ticket, replaceTags === true, replaceCustomFieldValues === true);
  if ('actions' in payload) {
    payload.actions = normalizeActionsToHtml(payload.actions);
  }

  const result = await movidesk.patch('/tickets', payload, { id });
  return toText(result);
}
