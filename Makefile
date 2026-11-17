SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help up down build migrate seed migrate-reset seed-reset test lint typecheck dev logs ps clean

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-14s\033[0m %s\n", $$1, $$2}'

up: ## Build and start the full stack (PostGIS + API)
	docker compose up -d --build

down: ## Stop and remove containers (keeps the data volume)
	docker compose down

build: ## Build the API image only
	docker compose build api

migrate: ## Apply SQL migrations to the running PostGIS container
	docker compose exec -T postgres sh -c 'for f in /migrations/*.sql; do psql -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}" -v ON_ERROR_STOP=1 -f "$$f"; done'

seed: ## Load demo seed data into the running PostGIS container
	docker compose exec -T postgres psql -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}" -v ON_ERROR_STOP=1 -f /seed.sql

migrate-reset: ## Recreate the database from scratch (destroys the data volume)
	docker compose down -v
	docker compose up -d postgres

seed-reset: migrate-reset seed ## Reset and reseed the database

test: ## Run the full test suite (PostGIS integration auto-skips when unreachable)
	npm test

lint: ## Run ESLint
	npm run lint

typecheck: ## Run TypeScript type checking
	npm run typecheck

dev: ## Run the API locally in watch mode (expects PostGIS on localhost:5432)
	npm run dev

logs: ## Tail logs for both services
	docker compose logs -f

ps: ## Show running containers
	docker compose ps

clean: ## Stop containers and remove the data volume
	docker compose down -v