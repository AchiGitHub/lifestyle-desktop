CREATE TABLE `credit_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`sent_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `credit_reminders_member_idx` ON `credit_reminders` (`member_id`);--> statement-breakpoint
CREATE TABLE `credit_sales` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`product_id` text,
	`product_name` text NOT NULL,
	`quantity` integer NOT NULL,
	`amount` real NOT NULL,
	`sold_at` text NOT NULL,
	`recorded_by` text,
	`device_id` text,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `credit_sales_member_idx` ON `credit_sales` (`member_id`);--> statement-breakpoint
CREATE INDEX `credit_sales_sold_at_idx` ON `credit_sales` (`sold_at`);