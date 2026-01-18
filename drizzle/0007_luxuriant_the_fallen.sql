ALTER TABLE `digital_twins` ADD `bigFiveTraits` json;--> statement-breakpoint
ALTER TABLE `digital_twins` ADD `judgmentThresholds` json;--> statement-breakpoint
ALTER TABLE `digital_twins` ADD `virtueWaveform` json;--> statement-breakpoint
ALTER TABLE `digital_twins` ADD `mineWaveform` json;--> statement-breakpoint
ALTER TABLE `digital_twins` ADD `personalitySimilarity` decimal(5,2);--> statement-breakpoint
ALTER TABLE `digital_twins` ADD `accuracyScore` decimal(5,2);--> statement-breakpoint
ALTER TABLE `digital_twins` ADD `trainingIterations` int DEFAULT 0 NOT NULL;