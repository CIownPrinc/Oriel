CREATE TABLE `cleanup_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`lease_expires_at` integer NOT NULL,
	`finished_at` integer,
	`counts` text,
	`failures` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cleanup_runs_one_running_idx` ON `cleanup_runs` (`status`) WHERE "cleanup_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX `cleanup_runs_created_idx` ON `cleanup_runs` (`created_at`);