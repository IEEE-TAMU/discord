import { Data } from 'effect';

export class BoardNotFound extends Data.TaggedError('BoardNotFound')<{
	channelId?: string;
	name?: string;
}> {}

export class BoardNameTaken extends Data.TaggedError('BoardNameTaken')<{
	name: string;
}> {}

export class CardNotFound extends Data.TaggedError('CardNotFound')<{
	cardId: number;
}> {}

export class InvalidDate extends Data.TaggedError('InvalidDate')<{
	input: string;
}> {}

export class AssigneeConflict extends Data.TaggedError('AssigneeConflict') {}

export class NoUpdateFields extends Data.TaggedError('NoUpdateFields') {}

export class DatabaseError extends Data.TaggedError('DatabaseError')<{
	cause: unknown;
}> {}
