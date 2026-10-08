import * as movidesk from './movideskClient.js';
import { validateUpdateTicketPayload } from './updateTicketValidation.js';
import { normalizeActionsToHtml } from './ticketHtml.js';
import { mergeTags, mergeCustomFieldValues } from './ticketMerge.js';
import { toText, toError } from './toolResult.js';
async function mergeWithCurrentTicket(id, ticket, replaceTags, replaceCustomFieldValues) {
    const mergeTagsNeeded = Array.isArray(ticket.tags) && !replaceTags;
    const mergeCustomFieldsNeeded = Array.isArray(ticket.customFieldValues) && !replaceCustomFieldValues;
    if (!mergeTagsNeeded && !mergeCustomFieldsNeeded) {
        return ticket;
    }
    const current = await movidesk.get('/tickets', { id });
    const merged = { ...ticket };
    if (mergeTagsNeeded) {
        merged.tags = mergeTags(current.tags, ticket.tags);
    }
    if (mergeCustomFieldsNeeded) {
        merged.customFieldValues = mergeCustomFieldValues(current.customFieldValues, ticket.customFieldValues);
    }
    return merged;
}
export async function handleUpdateTicket(params) {
    const { id, replaceTags, replaceCustomFieldValues, ...ticket } = params;
    const validation = validateUpdateTicketPayload(ticket);
    if (!validation.ok) {
        return toError(validation.message);
    }
    const payload = await mergeWithCurrentTicket(id, ticket, replaceTags === true, replaceCustomFieldValues === true);
    if ('status' in payload && (payload.justification === undefined || payload.justification === null)) {
        payload.justification = '';
    }
    if ('actions' in payload) {
        payload.actions = normalizeActionsToHtml(payload.actions);
    }
    const result = await movidesk.patch('/tickets', payload, { id });
    return toText(result);
}
//# sourceMappingURL=updateTicketHandler.js.map