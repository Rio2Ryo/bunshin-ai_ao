CREATE TABLE `cumulative_waveforms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`twinId` int NOT NULL,
	`totalVirtueCount` int NOT NULL DEFAULT 0,
	`totalMineCount` int NOT NULL DEFAULT 0,
	`totalNeutralCount` int NOT NULL DEFAULT 0,
	`cumulativeJudgmentScores` json,
	`evaluatorBreakdown` json,
	`lastUpdated` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cumulative_waveforms_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `value_evaluations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`targetUserId` int NOT NULL,
	`targetTwinId` int NOT NULL,
	`evaluatorTwinId` int NOT NULL,
	`evaluatorUserId` int NOT NULL,
	`scenarioResponseId` int,
	`verdict` enum('virtue','mine','neutral') NOT NULL,
	`judgmentScores` json,
	`reason` text,
	`confidence` decimal(5,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `value_evaluations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `value_scenario_responses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`twinId` int NOT NULL,
	`scenarioId` varchar(100) NOT NULL,
	`scenarioCategory` varchar(100) NOT NULL,
	`scenarioText` text NOT NULL,
	`userResponse` text NOT NULL,
	`analysisResult` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `value_scenario_responses_id` PRIMARY KEY(`id`)
);
