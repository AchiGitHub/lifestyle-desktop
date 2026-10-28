CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`checked_in_at` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `visits_checked_in_idx` ON `visits` (`checked_in_at`);--> statement-breakpoint
CREATE INDEX `visits_member_idx` ON `visits` (`member_id`);