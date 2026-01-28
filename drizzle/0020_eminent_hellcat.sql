CREATE TABLE `experience_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`twinId` int NOT NULL,
	`action` varchar(50) NOT NULL,
	`experienceGained` int NOT NULL,
	`description` text,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `experience_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `twin_growth_status` (
	`id` int AUTO_INCREMENT NOT NULL,
	`twinId` int NOT NULL,
	`userId` int NOT NULL,
	`level` int NOT NULL DEFAULT 1,
	`experience` int NOT NULL DEFAULT 0,
	`evolutionType` varchar(50) NOT NULL DEFAULT 'basic',
	`energy` int NOT NULL DEFAULT 100,
	`fullness` int NOT NULL DEFAULT 100,
	`mood` int NOT NULL DEFAULT 100,
	`bond` int NOT NULL DEFAULT 0,
	`totalConversations` int NOT NULL DEFAULT 0,
	`totalImageGenerations` int NOT NULL DEFAULT 0,
	`totalFriendPredictions` int NOT NULL DEFAULT 0,
	`totalScenarioAnswers` int NOT NULL DEFAULT 0,
	`totalDiagnosticsCompleted` int NOT NULL DEFAULT 0,
	`totalKnowledgeEntries` int NOT NULL DEFAULT 0,
	`lastInteractionAt` timestamp,
	`consecutiveLoginDays` int NOT NULL DEFAULT 0,
	`lastLoginDate` varchar(10),
	`evolutionHistory` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `twin_growth_status_id` PRIMARY KEY(`id`),
	CONSTRAINT `twin_growth_status_twinId_unique` UNIQUE(`twinId`)
);
--> statement-breakpoint
CREATE TABLE `twin_milestones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`twinId` int NOT NULL,
	`milestoneType` varchar(100) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`icon` varchar(10),
	`achievedAt` timestamp NOT NULL DEFAULT (now()),
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `twin_milestones_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `twin_skills` (
	`id` int AUTO_INCREMENT NOT NULL,
	`twinId` int NOT NULL,
	`skillType` varchar(50) NOT NULL,
	`level` int NOT NULL DEFAULT 1,
	`experience` int NOT NULL DEFAULT 0,
	`unlockedAt` timestamp NOT NULL DEFAULT (now()),
	`maxedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `twin_skills_id` PRIMARY KEY(`id`)
);
