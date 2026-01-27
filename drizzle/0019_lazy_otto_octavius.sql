CREATE TABLE `image_generation_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('nano_banana_pro','dall_e','stable_diffusion','midjourney','flux') NOT NULL DEFAULT 'nano_banana_pro',
	`settings` json,
	`totalGenerations` int NOT NULL DEFAULT 0,
	`lastGeneratedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `image_generation_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `image_generation_settings_userId_unique` UNIQUE(`userId`)
);
