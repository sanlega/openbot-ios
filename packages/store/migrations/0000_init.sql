CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`bot_id` text NOT NULL,
	`chain_id` text,
	`summary` text NOT NULL,
	`detail` text NOT NULL,
	`risk` real,
	`status` text NOT NULL,
	`resolution` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `approvals_status_idx` ON `approvals` (`status`);--> statement-breakpoint
CREATE TABLE `bots` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`label` text,
	`description` text NOT NULL,
	`avatar` text,
	`pinned` integer DEFAULT false NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`is_chief_of_staff` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`last_active_at` integer,
	`archived_at` integer,
	`routing` text NOT NULL,
	`auth` text,
	`permission_preset` text NOT NULL,
	`computer` text NOT NULL,
	`connectors` text NOT NULL,
	`daily_usd` real,
	`daily_tokens` integer,
	`justification` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bots_slug_unique` ON `bots` (`slug`);--> statement-breakpoint
CREATE TABLE `cap_counters` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`window_start` integer NOT NULL,
	`window_sec` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cap_counters_scope_key_idx` ON `cap_counters` (`scope`,`key`);--> statement-breakpoint
CREATE TABLE `chains` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`mode` text NOT NULL,
	`routine_run_id` text,
	`status` text NOT NULL,
	`routine_depth` integer DEFAULT 0 NOT NULL,
	`bot_messages` integer DEFAULT 0 NOT NULL,
	`turns` integer DEFAULT 0 NOT NULL,
	`usd` real DEFAULT 0 NOT NULL,
	`tokens` integer DEFAULT 0 NOT NULL,
	`computer_steps` integer DEFAULT 0 NOT NULL,
	`wall_min` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `computer_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`chain_id` text NOT NULL,
	`goal` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`steps` integer DEFAULT 0 NOT NULL,
	`usd` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `computer_tasks_bot_id_idx` ON `computer_tasks` (`bot_id`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`app_id` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text NOT NULL,
	`tool_meta` text NOT NULL,
	`triggers` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`state_hash` text NOT NULL,
	`answers` text NOT NULL,
	`thresholds` text,
	`band` text NOT NULL,
	`outcome` text NOT NULL,
	`feedback` text,
	`request_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `decisions_purpose_idx` ON `decisions` (`purpose`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`public_key` text NOT NULL,
	`via` text NOT NULL,
	`paired_at` integer NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE TABLE `engine_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`engine` text NOT NULL,
	`session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `engine_sessions_bot_id_idx` ON `engine_sessions` (`bot_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`ts` integer NOT NULL,
	`type` text NOT NULL,
	`bot_id` text,
	`thread_id` text,
	`turn_id` text,
	`chain_id` text,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_id_unique` ON `events` (`id`);--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`type`);--> statement-breakpoint
CREATE INDEX `events_bot_id_idx` ON `events` (`bot_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`author` text NOT NULL,
	`text` text NOT NULL,
	`attachments` text NOT NULL,
	`chain_id` text,
	`hop` integer DEFAULT 0 NOT NULL,
	`reply_to` text,
	`created_at` integer NOT NULL,
	`proactive` integer DEFAULT false NOT NULL,
	`kind` text,
	`options` text,
	`deadline` integer,
	`dedupe_key` text,
	`delivery` text NOT NULL,
	`pushed` integer DEFAULT false NOT NULL,
	`notify_decision_id` text
);
--> statement-breakpoint
CREATE INDEX `messages_thread_id_idx` ON `messages` (`thread_id`);--> statement-breakpoint
CREATE INDEX `messages_dedupe_key_idx` ON `messages` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `routine_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`chain_id` text NOT NULL,
	`cause` text NOT NULL,
	`trigger_event_ids` text NOT NULL,
	`dry_run` integer NOT NULL,
	`status` text NOT NULL,
	`skip_reason` text,
	`usage` text NOT NULL,
	`result_summary` text,
	`planned_actions` text,
	`started_at` integer,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `routine_runs_routine_id_idx` ON `routine_runs` (`routine_id`);--> statement-breakpoint
CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`created_by` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`live_approved` integer DEFAULT false NOT NULL,
	`trigger` text NOT NULL,
	`limits` text NOT NULL,
	`paused_reason` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_run_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `routines_bot_id_idx` ON `routines` (`bot_id`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`match` text NOT NULL,
	`effect` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`caps` text NOT NULL,
	`budgets` text NOT NULL,
	`quiet_hours` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setup_state` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`typesafe` text,
	`claude` text,
	`codex` text,
	`composio` text,
	`tailscale` text,
	`cloudflare` text,
	`completed_at` integer
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`kind` text DEFAULT 'dm' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `threads_bot_id_idx` ON `threads` (`bot_id`);--> statement-breakpoint
CREATE TABLE `trigger_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`routine_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`payload_ref` text NOT NULL,
	`matched` integer NOT NULL,
	`match_decision_id` text,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trigger_events_routine_id_idx` ON `trigger_events` (`routine_id`);--> statement-breakpoint
CREATE INDEX `trigger_events_payload_hash_idx` ON `trigger_events` (`payload_hash`);--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`chain_id` text NOT NULL,
	`engine` text NOT NULL,
	`model` text NOT NULL,
	`effort` text,
	`route_decision_id` text,
	`session_id` text,
	`status` text NOT NULL,
	`usage` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `turns_chain_id_idx` ON `turns` (`chain_id`);--> statement-breakpoint
CREATE INDEX `turns_bot_id_idx` ON `turns` (`bot_id`);