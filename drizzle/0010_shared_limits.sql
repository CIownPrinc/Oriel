CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limits_window_idx` ON `rate_limits` (`window_start`);--> statement-breakpoint
CREATE INDEX `cost_user_time_idx` ON `cost_records` (`user_id`,`created_at`);