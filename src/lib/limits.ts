/** Max characters per card field. Shared by the editor (pre-save check) and the API (zod), matching the DB checks. */
export const CARD_LIMITS = { term: 300, definition: 3000, phonetic: 300, example: 3000, example_translation: 3000, notes: 3000, synonyms: 500, antonyms: 500 } as const;
export type LimitedField = keyof typeof CARD_LIMITS;
export const FIELD_LABELS: Record<LimitedField, string> = { term: 'Từ', definition: 'Nghĩa', phonetic: 'Phiên âm', example: 'Ví dụ', example_translation: 'Dịch ví dụ', notes: 'Ghi chú', synonyms: 'Đồng nghĩa', antonyms: 'Trái nghĩa' };
/** Cards sent per request when saving; keeps each request small and fast. */
export const CARD_BATCH = 200;
