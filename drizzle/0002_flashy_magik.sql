ALTER TABLE `traffic_records` ADD `survey_type` text DEFAULT 'road' NOT NULL;--> statement-breakpoint
ALTER TABLE `traffic_records` ADD `turn_data` text DEFAULT '' NOT NULL;