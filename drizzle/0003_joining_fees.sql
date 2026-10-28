ALTER TABLE `membership_types` ADD `joining_fee` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `registration_members` ADD `joining_fee` real DEFAULT 0 NOT NULL;