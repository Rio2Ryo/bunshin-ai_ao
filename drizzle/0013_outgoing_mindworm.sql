CREATE TABLE `clawdbot_connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`twinId` int NOT NULL,
	`gatewayUrl` varchar(500) NOT NULL,
	`authToken` varchar(500),
	`agentId` varchar(100) NOT NULL DEFAULT 'main',
	`status` enum('pending','testing','active','error','disconnected') NOT NULL DEFAULT 'pending',
	`lastConnectionTest` timestamp,
	`lastError` text,
	`settings` json,
	`totalMessages` int NOT NULL DEFAULT 0,
	`lastMessageAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `clawdbot_connections_id` PRIMARY KEY(`id`),
	CONSTRAINT `clawdbot_connections_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `clawdbot_message_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`connectionId` int NOT NULL,
	`userId` int NOT NULL,
	`twinId` int NOT NULL,
	`direction` enum('to_clawdbot','from_clawdbot') NOT NULL,
	`content` text NOT NULL,
	`clawdbotSessionKey` varchar(255),
	`sourceChannel` varchar(50),
	`status` enum('pending','sent','received','error') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`responseTimeMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `clawdbot_message_logs_id` PRIMARY KEY(`id`)
);
