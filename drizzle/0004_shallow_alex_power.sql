ALTER TABLE `digital_twins` ADD `isPublic` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `digital_twins` ADD `publicBio` text;--> statement-breakpoint
ALTER TABLE `digital_twins` ADD `tags` json;--> statement-breakpoint
ALTER TABLE `users` ADD `stripeCustomerId` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `stripeSubscriptionId` varchar(255);