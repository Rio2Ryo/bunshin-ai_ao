CREATE TABLE `webhook_debug_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source` varchar(50) NOT NULL,
	`eventType` varchar(50),
	`requestBody` text,
	`headers` text,
	`processingStep` varchar(100),
	`result` varchar(50),
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `webhook_debug_logs_id` PRIMARY KEY(`id`)
);
