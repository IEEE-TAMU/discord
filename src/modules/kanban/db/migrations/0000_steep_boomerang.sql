CREATE TABLE `boards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`channel_id` varchar(30) NOT NULL,
	`message_id` varchar(30),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `boards_id` PRIMARY KEY(`id`),
	CONSTRAINT `boards_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`board_id` int NOT NULL,
	`column` enum('todo','in_progress','done') NOT NULL DEFAULT 'todo',
	`title` varchar(255) NOT NULL,
	`description` text,
	`author_id` varchar(30) NOT NULL,
	`assignee_id` varchar(30),
	`due_date` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`card_id` int NOT NULL,
	`user_id` varchar(30) NOT NULL,
	`remind_at` datetime NOT NULL,
	`message` varchar(500),
	`sent` int NOT NULL DEFAULT 0,
	CONSTRAINT `reminders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `cards` ADD CONSTRAINT `cards_board_id_boards_id_fk` FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reminders` ADD CONSTRAINT `reminders_card_id_cards_id_fk` FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON DELETE no action ON UPDATE no action;