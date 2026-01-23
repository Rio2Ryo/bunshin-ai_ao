CREATE TABLE `friend_predictions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`targetUserId` int NOT NULL,
	`targetTwinId` int NOT NULL,
	`predictorUserId` int NOT NULL,
	`predictorTwinId` int NOT NULL,
	`scenarioResponseId` int,
	`scenarioId` varchar(100) NOT NULL,
	`scenarioText` text NOT NULL,
	`predictedResponse` text NOT NULL,
	`predictedVerdict` enum('virtue','mine','neutral') NOT NULL,
	`predictedJudgmentScores` json,
	`predictionReason` text,
	`confidence` decimal(5,2),
	`actualVerdict` enum('virtue','mine','neutral'),
	`isCorrect` int,
	`similarityScore` decimal(5,2),
	`comparedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `friend_predictions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `intimacy_scores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`friendId` int NOT NULL,
	`totalMessageCount` int NOT NULL DEFAULT 0,
	`conversationDays` int NOT NULL DEFAULT 0,
	`lastConversationAt` timestamp,
	`totalPredictions` int NOT NULL DEFAULT 0,
	`correctPredictions` int NOT NULL DEFAULT 0,
	`predictionAccuracy` decimal(5,2),
	`intimacyScore` decimal(5,2) NOT NULL DEFAULT '0',
	`intimacyLevel` enum('stranger','acquaintance','friend','close_friend','best_friend') NOT NULL DEFAULT 'stranger',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `intimacy_scores_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `other_perspective_waveforms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`twinId` int NOT NULL,
	`totalVirtueCount` int NOT NULL DEFAULT 0,
	`totalMineCount` int NOT NULL DEFAULT 0,
	`totalNeutralCount` int NOT NULL DEFAULT 0,
	`cumulativeJudgmentScores` json,
	`predictorBreakdown` json,
	`selfReportGap` decimal(5,2),
	`lastUpdated` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `other_perspective_waveforms_id` PRIMARY KEY(`id`)
);
