ALTER TABLE `media_objects` ADD `part_key` text;--> statement-breakpoint
ALTER TABLE `media_objects` ADD `start_offset_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `media_session_part_idx` ON `media_objects` (`session_id`,`part_key`);--> statement-breakpoint
-- Recordings made before parts existed are one part; label it with the key that clients without
-- part support upload to, so a session that is live during the deploy keeps appending to it.
UPDATE `media_objects` SET `part_key` = 'legacy-recording' WHERE `part_key` IS NULL AND `kind` = 'session_recording';
