CREATE TABLE `delegations` (
	`id` text PRIMARY KEY NOT NULL,
	`chain_id` text NOT NULL,
	`requester_bot_id` text NOT NULL,
	`assignee_bot_id` text NOT NULL,
	`owner_thread_id` text NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`status_message` text,
	`result` text,
	`engine` text,
	`round_trips` integer DEFAULT 1 NOT NULL,
	`wake_pending` integer DEFAULT false NOT NULL,
	`wake_kind` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_event_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `delegations_assignee_idx` ON `delegations` (`assignee_bot_id`);--> statement-breakpoint
CREATE INDEX `delegations_requester_idx` ON `delegations` (`requester_bot_id`);--> statement-breakpoint
CREATE INDEX `delegations_state_idx` ON `delegations` (`state`);