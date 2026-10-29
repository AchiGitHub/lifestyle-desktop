CREATE TABLE `pt_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sessions` integer NOT NULL,
	`price` real NOT NULL,
	`valid_duration` integer NOT NULL,
	`valid_duration_type` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pt_registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`trainer_id` text NOT NULL,
	`package_id` text,
	`package_name` text NOT NULL,
	`sessions` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`amount` real NOT NULL,
	`commission` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`trainer_id`) REFERENCES `trainers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`package_id`) REFERENCES `pt_packages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `pt_registrations_member_idx` ON `pt_registrations` (`member_id`);--> statement-breakpoint
CREATE INDEX `pt_registrations_trainer_idx` ON `pt_registrations` (`trainer_id`);--> statement-breakpoint
CREATE INDEX `pt_registrations_start_idx` ON `pt_registrations` (`start_date`);--> statement-breakpoint
CREATE INDEX `pt_registrations_end_idx` ON `pt_registrations` (`end_date`);--> statement-breakpoint
CREATE TABLE `trainers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_owner` integer DEFAULT false NOT NULL,
	`commission_percent` real DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `payments` ADD `pt_registration_id` text REFERENCES pt_registrations(id) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `payments_pt_registration_idx` ON `payments` (`pt_registration_id`);--> statement-breakpoint
ALTER TABLE `visits` ADD `pt_registration_id` text REFERENCES pt_registrations(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `visits_pt_registration_idx` ON `visits` (`pt_registration_id`);