CREATE TABLE `road_aliases` (
	`project_id` text NOT NULL,
	`alias_key` text NOT NULL,
	`alias_name` text NOT NULL,
	`road_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`project_id`, `alias_key`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_road_aliases_road` ON `road_aliases` (`project_id`,`road_id`);
