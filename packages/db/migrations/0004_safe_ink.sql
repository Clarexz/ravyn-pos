CREATE TABLE `print_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`store_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`color` text NOT NULL,
	`size` text NOT NULL,
	`price_cents` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `print_prices_store_kind_idx` ON `print_prices` (`store_id`,`color`,`size`);--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`store_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`print_price_id` text,
	`service_variant_id` text,
	`input_variant_id` text NOT NULL,
	`quantity` integer NOT NULL,
	FOREIGN KEY (`print_price_id`) REFERENCES `print_prices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`input_variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recipes_one_target" CHECK(("recipes"."print_price_id" IS NULL) <> ("recipes"."service_variant_id" IS NULL)),
	CONSTRAINT "recipes_quantity_positive" CHECK("recipes"."quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `recipes_print_idx` ON `recipes` (`print_price_id`);--> statement-breakpoint
CREATE INDEX `recipes_service_idx` ON `recipes` (`service_variant_id`);