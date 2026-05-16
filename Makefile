.PHONY: help install dev up down logs clean restart db-reset db-migrate db-seed

help:
	@echo "Gramoz Development Commands"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo "  make install      Install dependencies for server and web"
	@echo "  make dev          Start all services (infra + server + web)"
	@echo "  make up           Start infrastructure only (postgres + redis)"
	@echo "  make down         Stop all services"
	@echo "  make logs         Show logs from all services"
	@echo "  make restart      Restart all services"
	@echo "  make db-reset     Reset database (drop volumes and restart)"
	@echo "  make db-migrate   Generate and push database migrations"
	@echo "  make db-seed      Seed database with sample data"
	@echo "  make clean        Clean all build artifacts and node_modules"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

install:
	@echo "📦 Installing dependencies..."
	cd server && npm install
	cd web && npm install
	@echo "✅ Dependencies installed"

up:
	@echo "🚀 Starting infrastructure..."
	docker compose up -d
	@echo "✅ Infrastructure running"

down:
	@echo "🛑 Stopping all services..."
	docker compose down
	@echo "✅ Services stopped"

dev: up
	@echo "🚀 Starting development servers..."
	@echo "   Server: http://localhost:5000"
	@echo "   Web: http://localhost:3000"
	@make -j2 dev-server dev-web

dev-server:
	cd server && npm run start:dev

dev-web:
	cd web && npm run dev

logs:
	docker compose logs -f

restart:
	@make down
	@make up

db-reset:
	@echo "⚠️  Resetting database..."
	docker compose down -v
	docker compose up -d postgres
	@echo "✅ Database reset complete"

db-migrate:
	@echo "🔄 Generating and pushing migrations..."
	cd server && npm run db:generate && npm run db:push
	@echo "✅ Migrations applied"

db-seed:
	@echo "🌱 Seeding database..."
	cd server && npm run db:seed
	@echo "✅ Seed complete"

clean:
	@echo "🧹 Cleaning build artifacts..."
	rm -rf server/dist server/node_modules
	rm -rf web/.next web/node_modules
	docker compose down -v
	@echo "✅ Clean complete"
