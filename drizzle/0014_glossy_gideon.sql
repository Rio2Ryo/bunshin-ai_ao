CREATE TABLE `conversation_learning` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`twinId` int NOT NULL,
	`learnedTraits` json,
	`totalConversations` int NOT NULL DEFAULT 0,
	`lastAnalysisAt` timestamp,
	`analysisCount` int NOT NULL DEFAULT 0,
	`pendingConversations` int NOT NULL DEFAULT 0,
	`autoLearnEnabled` int NOT NULL DEFAULT 1,
	`learningThreshold` int NOT NULL DEFAULT 10,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversation_learning_id` PRIMARY KEY(`id`),
	CONSTRAINT `conversation_learning_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `conversation_snippets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`twinId` int NOT NULL,
	`source` enum('clawdbot','web_chat','matching','group') NOT NULL,
	`sourceId` varchar(255),
	`userMessage` text NOT NULL,
	`context` text,
	`extractedFeatures` json,
	`isAnalyzed` int NOT NULL DEFAULT 0,
	`analyzedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conversation_snippets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `group_conversation_observations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`twinId` int NOT NULL,
	`groupId` varchar(255) NOT NULL,
	`groupName` varchar(255),
	`speakerType` enum('self','other') NOT NULL,
	`speakerName` varchar(255),
	`message` text NOT NULL,
	`replyToId` int,
	`threadContext` text,
	`isRelevantForLearning` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `group_conversation_observations_id` PRIMARY KEY(`id`)
);
