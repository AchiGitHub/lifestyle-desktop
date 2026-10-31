CREATE TABLE `class_series` (
	`id` text PRIMARY KEY NOT NULL,
	`class_type_id` text NOT NULL,
	`weekdays` text NOT NULL,
	`start_time` text NOT NULL,
	`minutes` integer NOT NULL,
	`trainer_id` text,
	`starts_on` text NOT NULL,
	`ends_on` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`class_type_id`) REFERENCES `class_types`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`trainer_id`) REFERENCES `trainers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `class_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`class_type_id` text NOT NULL,
	`series_id` text,
	`date` text NOT NULL,
	`start_time` text NOT NULL,
	`minutes` integer NOT NULL,
	`trainer_id` text,
	`cancelled` integer DEFAULT false NOT NULL,
	`changed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`class_type_id`) REFERENCES `class_types`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`series_id`) REFERENCES `class_series`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`trainer_id`) REFERENCES `trainers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `class_sessions_date_idx` ON `class_sessions` (`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `class_sessions_series_date_idx` ON `class_sessions` (`series_id`,`date`);--> statement-breakpoint
CREATE TABLE `class_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`minutes` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
