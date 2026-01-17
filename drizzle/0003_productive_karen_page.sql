CREATE TABLE `usage_tracking` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`matchingsThisMonth` int NOT NULL DEFAULT 0,
	`lastResetAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `usage_tracking_id` PRIMARY KEY(`id`),
	CONSTRAINT `usage_tracking_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `plan` enum('free','premium','enterprise') DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `friendCode` varchar(8);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_friendCode_unique` UNIQUE(`friendCode`);