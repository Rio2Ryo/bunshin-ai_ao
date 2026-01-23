CREATE TABLE `daily_memory_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`twinId` int NOT NULL,
	`logDate` varchar(10) NOT NULL,
	`content` text NOT NULL,
	`summary` text,
	`keyPoints` json,
	`emotionalTone` varchar(50),
	`topics` json,
	`messageCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `daily_memory_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `heartbeat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`twinId` int NOT NULL,
	`settingId` int NOT NULL,
	`messageType` varchar(50) NOT NULL,
	`content` text NOT NULL,
	`status` enum('pending','sent','delivered','read','failed') NOT NULL DEFAULT 'pending',
	`sentAt` timestamp,
	`deliveredAt` timestamp,
	`readAt` timestamp,
	`userResponse` text,
	`respondedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `heartbeat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `heartbeat_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`twinId` int NOT NULL,
	`isEnabled` int NOT NULL DEFAULT 0,
	`frequency` enum('daily','weekly','custom') NOT NULL DEFAULT 'daily',
	`preferredTime` varchar(5),
	`preferredDays` json,
	`timezone` varchar(50) NOT NULL DEFAULT 'Asia/Tokyo',
	`cronExpression` varchar(100),
	`messageTypes` json,
	`customPrompt` text,
	`notificationChannels` json,
	`totalSent` int NOT NULL DEFAULT 0,
	`lastSentAt` timestamp,
	`nextScheduledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `heartbeat_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `line_connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`twinId` int NOT NULL,
	`lineUserId` varchar(255) NOT NULL,
	`lineDisplayName` varchar(255),
	`linePictureUrl` varchar(1000),
	`status` enum('pending','active','paused','disconnected') NOT NULL DEFAULT 'pending',
	`settings` json,
	`totalMessages` int NOT NULL DEFAULT 0,
	`lastMessageAt` timestamp,
	`connectedAt` timestamp,
	`disconnectedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `line_connections_id` PRIMARY KEY(`id`),
	CONSTRAINT `line_connections_userId_unique` UNIQUE(`userId`),
	CONSTRAINT `line_connections_lineUserId_unique` UNIQUE(`lineUserId`)
);
--> statement-breakpoint
CREATE TABLE `line_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`connectionId` int NOT NULL,
	`userId` int NOT NULL,
	`twinId` int NOT NULL,
	`lineMessageId` varchar(255),
	`direction` enum('incoming','outgoing') NOT NULL,
	`messageType` enum('text','image','audio','video','sticker','location','flex') NOT NULL DEFAULT 'text',
	`content` text,
	`mediaUrl` varchar(1000),
	`status` enum('received','processing','sent','delivered','read','failed') NOT NULL DEFAULT 'received',
	`chatSessionId` int,
	`chatMessageId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `line_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `long_term_memory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`twinId` int NOT NULL,
	`category` enum('preference','fact','decision','goal','relationship','skill','experience','belief','routine','other') NOT NULL,
	`title` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`importance` int NOT NULL DEFAULT 5,
	`source` varchar(100),
	`sourceId` varchar(255),
	`tags` json,
	`embedding` json,
	`lastAccessedAt` timestamp,
	`accessCount` int NOT NULL DEFAULT 0,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `long_term_memory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `multi_agent_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`senderTwinId` int NOT NULL,
	`senderUserId` int NOT NULL,
	`content` text NOT NULL,
	`messageType` enum('message','proposal','question','answer','decision','action_item','summary','system') NOT NULL DEFAULT 'message',
	`mentions` json,
	`reactions` json,
	`replyToId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `multi_agent_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `multi_agent_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`creatorUserId` int NOT NULL,
	`creatorTwinId` int NOT NULL,
	`status` enum('draft','active','paused','completed','cancelled') NOT NULL DEFAULT 'draft',
	`participants` json,
	`taskType` enum('brainstorm','project','discussion','research','planning','review','custom') NOT NULL DEFAULT 'discussion',
	`progress` int NOT NULL DEFAULT 0,
	`milestones` json,
	`deliverables` json,
	`deadline` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `multi_agent_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` int AUTO_INCREMENT NOT NULL,
	`skillId` varchar(100) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`category` enum('productivity','communication','information','entertainment','health','finance','learning','social','custom') NOT NULL,
	`type` enum('builtin','community','custom') NOT NULL DEFAULT 'builtin',
	`version` varchar(20) NOT NULL DEFAULT '1.0.0',
	`author` varchar(255),
	`authorId` int,
	`config` json,
	`executionCode` text,
	`systemPrompt` text,
	`usageCount` int NOT NULL DEFAULT 0,
	`rating` decimal(3,2),
	`ratingCount` int NOT NULL DEFAULT 0,
	`isActive` int NOT NULL DEFAULT 1,
	`isPublic` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `skills_id` PRIMARY KEY(`id`),
	CONSTRAINT `skills_skillId_unique` UNIQUE(`skillId`)
);
--> statement-breakpoint
CREATE TABLE `user_skills` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`twinId` int NOT NULL,
	`skillId` int NOT NULL,
	`isEnabled` int NOT NULL DEFAULT 1,
	`userConfig` json,
	`usageCount` int NOT NULL DEFAULT 0,
	`lastUsedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_skills_id` PRIMARY KEY(`id`)
);
