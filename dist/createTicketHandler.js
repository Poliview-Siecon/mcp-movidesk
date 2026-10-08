import * as movidesk from './movideskClient.js';
import { validateCreateTicketPayload } from './createTicketValidation.js';
import { normalizeActionsToHtml } from './ticketHtml.js';
import { toText, toError } from './toolResult.js';
export async function handleCreateTicket(params) {
    const validation = validateCreateTicketPayload(params);
    if (!validation.ok) {
        return toError(validation.message);
    }
    const payload = 'actions' in params ? { ...params, actions: normalizeActionsToHtml(params.actions) } : params;
    const result = await movidesk.post('/tickets', payload);
    return toText(result);
}
//# sourceMappingURL=createTicketHandler.js.map