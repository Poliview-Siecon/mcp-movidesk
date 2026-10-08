type CustomFieldValue = {
    customFieldId?: unknown;
    customFieldRuleId?: unknown;
    line?: unknown;
};
export declare function mergeTags(existing: unknown, incoming: string[]): string[];
export declare function mergeCustomFieldValues(existing: unknown, incoming: CustomFieldValue[]): CustomFieldValue[];
export {};
//# sourceMappingURL=ticketMerge.d.ts.map