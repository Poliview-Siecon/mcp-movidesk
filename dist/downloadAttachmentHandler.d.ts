import { type ContentBlock, type ToolResult } from './toolResult.js';
export declare const MAX_INLINE_BYTES: number;
export type DownloadAttachmentParams = {
    path?: unknown;
    fileName?: unknown;
    destinationPath?: unknown;
    overwrite?: unknown;
};
export declare function sanitizeFileName(name: string): string;
export declare function resolveMimeType(contentType: string | undefined, fileName: string): string;
export declare function handleDownloadAttachment(params: DownloadAttachmentParams): Promise<ToolResult<ContentBlock>>;
//# sourceMappingURL=downloadAttachmentHandler.d.ts.map