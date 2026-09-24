.PHONY: help build dev pack pot preview test translations

.DEFAULT_GOAL := help

help: ## Show this help message
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

build: ## Compile the gsettings schema (glib-compile-schemas)
	npm run build

dev: ## Nested GNOME Shell window for testing (needs mutter-devkit)
	npm run dev

pack: ## Build the zip for extensions.gnome.org
	npm run pack

pot: ## Regenerate po/supervise-indicator.pot from the sources
	npm run pot

preview: ## Print the menu content from the real log (no shell needed)
	npm run preview

test: ## Run the parser and classification tests
	npm run test

translations: ## Compile every po/<lang>.po into locale/<lang>/LC_MESSAGES
	npm run translations
