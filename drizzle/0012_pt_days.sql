CREATE TABLE `pt_days` (
	`id` text PRIMARY KEY NOT NULL,
	`pt_registration_id` text NOT NULL,
	`date` text NOT NULL,
	`start_time` text NOT NULL,
	`minutes` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`pt_registration_id`) REFERENCES `pt_registrations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pt_days_date_idx` ON `pt_days` (`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `pt_days_package_date_idx` ON `pt_days` (`pt_registration_id`,`date`);