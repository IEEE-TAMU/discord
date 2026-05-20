import { Data, Option } from 'effect';

export class InvalidDate extends Data.TaggedError('InvalidDate')<{
	input: string;
}> {}

export function parseDate(input: string): Option.Option<Date> {
	const now = new Date();
	const relativeMatch = input.match(/^(\d+)([hwdm])$/);
	if (relativeMatch) {
		const value = parseInt(relativeMatch[1]!, 10);
		const unit = relativeMatch[2]!;
		switch (unit) {
		case 'h':
			return Option.some(new Date(now.getTime() + value * 60 * 60 * 1000));
		case 'd':
			return Option.some(new Date(now.getTime() + value * 24 * 60 * 60 * 1000));
		case 'w':
			return Option.some(new Date(now.getTime() + value * 7 * 24 * 60 * 60 * 1000));
		case 'm':
			return Option.some(new Date(now.getTime() + value * 30 * 24 * 60 * 60 * 1000));
		}
	}

	const lower = input.toLowerCase();
	if (lower === 'tomorrow') {
		const tomorrow = new Date(now);
		tomorrow.setDate(tomorrow.getDate() + 1);
		tomorrow.setHours(9, 0, 0, 0);
		return Option.some(tomorrow);
	}

	if (lower === 'next monday') {
		const next = new Date(now);
		const dayOfWeek = next.getDay();
		const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7 || 7;
		next.setDate(next.getDate() + daysUntilMonday);
		next.setHours(9, 0, 0, 0);
		return Option.some(next);
	}

	if (lower === 'end of week') {
		const end = new Date(now);
		const dayOfWeek = end.getDay();
		const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 5;
		end.setDate(end.getDate() + daysUntilFriday);
		end.setHours(17, 0, 0, 0);
		return Option.some(end);
	}

	if (lower === 'end of month') {
		const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 17, 0, 0);
		return Option.some(end);
	}

	const parsed = new Date(input);
	if (!isNaN(parsed.getTime())) {
		return Option.some(parsed);
	}

	return Option.none();
}
