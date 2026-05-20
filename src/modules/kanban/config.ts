import { ConfigProvider, Duration } from 'effect';

const defaults = ConfigProvider.fromJson({
	KANBAN_DB_HOST: 'localhost',
	KANBAN_DB_PORT: '3306',
	KANBAN_DB_USER: 'kanban',
	KANBAN_DB_PASSWORD: 'kanban',
	KANBAN_DB_NAME: 'kanban_dev',
	REMINDER_POLL_INTERVAL: '30 seconds',
});

export const KanbanConfig = ConfigProvider.orElse(ConfigProvider.fromEnv(), () => defaults);

export const reminderPollInterval = Duration.decode('30 seconds');
