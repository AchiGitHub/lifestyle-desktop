ALTER TABLE `payments` ADD `member_id` text REFERENCES members(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `payments_member_idx` ON `payments` (`member_id`);