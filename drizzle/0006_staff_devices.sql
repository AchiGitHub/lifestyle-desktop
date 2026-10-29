CREATE TABLE `stock_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`kind` text NOT NULL,
	`change` integer NOT NULL,
	`quantity_after` integer NOT NULL,
	`recorded_by` text,
	`device_id` text,
	`changed_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stock_changes_changed_at_idx` ON `stock_changes` (`changed_at`);--> statement-breakpoint
CREATE INDEX `stock_changes_product_idx` ON `stock_changes` (`product_id`);--> statement-breakpoint
ALTER TABLE `payments` ADD `recorded_by` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `device_id` text;