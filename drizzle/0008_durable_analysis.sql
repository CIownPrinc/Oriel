ALTER TABLE `answers` ADD `turn_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `answers_turn_key_idx` ON `answers` (`session_id`,`turn_key`);--> statement-breakpoint
ALTER TABLE `interview_sessions` ADD `ladder_credited_at` integer;--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `lease_expires_at` integer;--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `rerun_requested` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- One job row per session from now on: keep each session's newest row (jobs are only status).
DELETE FROM `processing_jobs` WHERE rowid NOT IN (SELECT MAX(rowid) FROM `processing_jobs` GROUP BY `session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_session_idx` ON `processing_jobs` (`session_id`);--> statement-breakpoint
-- Ladder sessions analysed before this change already had their chance to count; mark them so a
-- reanalysis can't count them a second time.
UPDATE `interview_sessions` SET `ladder_credited_at` = (unixepoch() * 1000) WHERE `analysis_status` = 'complete' AND `interview_id` IN (SELECT `id` FROM `interviews` WHERE `ladder_level` IS NOT NULL);
