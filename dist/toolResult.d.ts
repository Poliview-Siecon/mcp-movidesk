export type TextContent = {
    type: 'text';
    text: string;
};
export type ImageContent = {
    type: 'image';
    data: string;
    mimeType: string;
};
export type EmbeddedResourceContent = {
    type: 'resource';
    resource: {
        uri: string;
        mimeType?: string;
        blob: string;
    };
};
export type ContentBlock = TextContent | ImageContent | EmbeddedResourceContent;
export type ToolResult<C extends ContentBlock = TextContent> = {
    content: C[];
    isError?: boolean;
};
export declare function toText(result: unknown): ToolResult;
export declare function toError(message: string): ToolResult;
//# sourceMappingURL=toolResult.d.ts.map