CREATE TABLE `line_group_observations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` varchar(255) NOT NULL,
	`groupName` varchar(255),
	`observedLineUserId` varchar(255) NOT NULL,
	`observedUserId` int NOT NULL,
	`messageContent` text NOT NULL,
	`messageType` varchar(50) NOT NULL DEFAULT 'text',
	`analyzedTraits` json,
	`isProcessed` boolean NOT NULL DEFAULT false,
	`processedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `line_group_observations_id` PRIMARY KEY(`id`)
);
