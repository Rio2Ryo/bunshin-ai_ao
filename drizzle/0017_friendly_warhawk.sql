CREATE TABLE `cards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`ownerUserId` int,
	`cardType` enum('business_card','shop_card','idol_sign','membership','event','other') NOT NULL DEFAULT 'business_card',
	`title` varchar(255) NOT NULL,
	`subtitle` varchar(255),
	`description` text,
	`imageUrl` varchar(1000),
	`thumbnailUrl` varchar(1000),
	`contactInfo` json,
	`businessInfo` json,
	`customFields` json,
	`isPublic` int NOT NULL DEFAULT 1,
	`totalScans` int NOT NULL DEFAULT 0,
	`totalSaves` int NOT NULL DEFAULT 0,
	`lastScannedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cards_id` PRIMARY KEY(`id`),
	CONSTRAINT `cards_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `user_cards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`cardId` int NOT NULL,
	`acquiredAt` timestamp NOT NULL DEFAULT (now()),
	`acquiredMethod` enum('nfc_scan','qr_scan','link','manual') NOT NULL DEFAULT 'nfc_scan',
	`memo` text,
	`tags` json,
	`isFavorite` int NOT NULL DEFAULT 0,
	`lastViewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_cards_id` PRIMARY KEY(`id`)
);
