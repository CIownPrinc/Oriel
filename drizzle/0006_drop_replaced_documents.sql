-- Replaced resumes and job descriptions used to be kept as inactive rows. The privacy policy says
-- they are kept only until replaced, so remove the old versions. Interviews that used them keep
-- their data; their reference is cleared first, so this doesn't depend on foreign-key enforcement
-- being on for the connection that runs migrations.
UPDATE `interviews` SET `resume_id` = NULL WHERE `resume_id` IN (SELECT `id` FROM `resumes` WHERE `is_active` = 0);
--> statement-breakpoint
UPDATE `interviews` SET `job_description_id` = NULL WHERE `job_description_id` IN (SELECT `id` FROM `job_descriptions` WHERE `is_active` = 0);
--> statement-breakpoint
DELETE FROM `resumes` WHERE `is_active` = 0;
--> statement-breakpoint
DELETE FROM `job_descriptions` WHERE `is_active` = 0;
