CREATE TABLE `ai_api_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('openai','gemini','anthropic','grok') NOT NULL,
	`apiKey` varchar(500) NOT NULL,
	`isActive` int NOT NULL DEFAULT 1,
	`lastValidated` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_api_configs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`role` enum('user','assistant','system') NOT NULL,
	`content` text NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`twinId` int NOT NULL,
	`title` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chat_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `digital_twins` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`personality` text,
	`systemPrompt` text,
	`status` enum('active','inactive','training') NOT NULL DEFAULT 'inactive',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `digital_twins_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `knowledge_base` (
	`id` int AUTO_INCREMENT NOT NULL,
	`twinId` int NOT NULL,
	`sourceType` enum('upload','api','manual') NOT NULL,
	`sourceId` varchar(255),
	`title` varchar(500),
	`content` text,
	`summary` text,
	`embedding` json,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `knowledge_base_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `matching_dialogues` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`speakerTwinId` int NOT NULL,
	`content` text NOT NULL,
	`aiProvider` varchar(100),
	`aiModel` varchar(255),
	`turnNumber` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `matching_dialogues_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `matching_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`compatibilityScore` decimal(5,2),
	`collaborationPotential` text,
	`strengths` json,
	`challenges` json,
	`recommendations` json,
	`summary` text,
	`detailedAnalysis` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `matching_results_id` PRIMARY KEY(`id`),
	CONSTRAINT `matching_results_sessionId_unique` UNIQUE(`sessionId`)
);
--> statement-breakpoint
CREATE TABLE `matching_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`twin1Id` int NOT NULL,
	`twin2Id` int NOT NULL,
	`theme` varchar(500) NOT NULL,
	`status` enum('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `matching_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orchestration_roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`roleName` varchar(255) NOT NULL,
	`roleDescription` text,
	`assignedProvider` enum('openai','gemini','anthropic','grok','builtin') NOT NULL,
	`assignedModel` varchar(255),
	`priority` int NOT NULL DEFAULT 1,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orchestration_roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `uploaded_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`twinId` int,
	`filename` varchar(500) NOT NULL,
	`fileKey` varchar(500) NOT NULL,
	`url` varchar(1000) NOT NULL,
	`mimeType` varchar(100),
	`size` int,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`processedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `uploaded_files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`displayName` varchar(255),
	`bio` text,
	`skills` json,
	`experience` text,
	`businessInfo` text,
	`expertise` json,
	`industry` varchar(255),
	`company` varchar(255),
	`position` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_profiles_userId_unique` UNIQUE(`userId`)
);
