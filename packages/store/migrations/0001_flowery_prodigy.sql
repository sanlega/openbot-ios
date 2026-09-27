CREATE TABLE `input_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`chain_id` text,
	`title` text NOT NULL,
	`intro` text,
	`fields` text NOT NULL,
	`status` text NOT NULL,
	`answers` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `input_requests_bot_id_idx` ON `input_requests` (`bot_id`);--> statement-breakpoint
CREATE INDEX `input_requests_status_idx` ON `input_requests` (`status`);--> statement-breakpoint
ALTER TABLE `messages` ADD `input_request_id` text;