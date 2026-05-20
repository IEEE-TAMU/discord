export const COLUMNS = ['todo', 'in_progress', 'done'] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_LABELS: Record<Column, string> = {
	todo: 'To Do',
	in_progress: 'In Progress',
	done: 'Done',
};

export const COLUMN_EMOJIS: Record<Column, string> = {
	todo: '\u{1F4CB}',
	in_progress: '\u2699\uFE0F',
	done: '\u2705',
};
