CREATE TABLE `cashups` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`opening_float` real NOT NULL,
	`paid_out` real NOT NULL,
	`paid_out_note` text,
	`counted` real NOT NULL,
	`note` text,
	`cash_in` real NOT NULL,
	`card_total` real NOT NULL,
	`transfer_total` real NOT NULL,
	`expected` real NOT NULL,
	`difference` real NOT NULL,
	`closed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cashups_date_unique` ON `cashups` (`date`);--> statement-breakpoint
ALTER TABLE `payments` ADD `receipt_no` integer;--> statement-breakpoint
-- Existing payments get receipt numbers in date order (hand-written; keep in step with numberReceipts()).
UPDATE `payments` SET `receipt_no` = `numbered`.`n`
FROM (SELECT `id`, row_number() OVER (ORDER BY `paid_at`, `created_at`, `id`) AS `n` FROM `payments`) AS `numbered`
WHERE `numbered`.`id` = `payments`.`id`;--> statement-breakpoint
CREATE UNIQUE INDEX `payments_receipt_no_idx` ON `payments` (`receipt_no`);