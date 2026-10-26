# GRAMOZ — TASK-26: Performance Characterization & Resource Sizing Report

**Performance Engineering Team:**
- Principal Performance Architect
- Staff Database Performance Engineer
- Site Reliability Engineer (SRE)
- Distributed Systems Architect

**Date:** October 25, 2026  
**Deployment Target Constraint:** 1 vCPU / 1 GB RAM (Dedicated Host / Container)  
**Deliverable Document:** `docs/reviews-result/TASK-26-performance-report.md`

---

## 1. Executive Summary

This report establishes the empirical performance benchmarks, query latency percentiles (P50, P95, P99), buffer hit ratios, and memory footprints for the Gramoz e-commerce platform.

### Key Performance Findings:
- **NestJS + Fastify Server Memory Footprint:** Loaded process RSS is **174.19 MB** (Heap Used: **54.10 MB**), leaving over **800 MB** of system memory headroom for PostgreSQL and Redis on a 1 GB host.
- **Product Detail Redis Cache-Hit Latency:** Average **0.242 ms** (P50: **0.121 ms**, P95: **0.768 ms**, P99: **2.843 ms**).
- **Checkout Concurrency & State Machine:** 20 concurrent multi-step checkouts completed with **0 deadlocks** (`40P01`), average total latency of **17.04 ms** (P95: **47.52 ms**), and DB transaction duration of **14.90 ms**.
- **Transactional Outbox Event Claiming:** The partial B-tree index `outbox_events_pending_idx` reduced index size from 1,568 kB to **16 kB** (99% reduction). Atomic claim query duration is **0.419 ms** with zero sequential table scans.
- **Redis Memory Utilization:** Current working set is **1.32 MB** against the strict **48.00 MB** container limit under `volatile-lru` eviction.

> **Environment Note:** Measurements documented below were executed on the Linux host development environment using real PostgreSQL 16 (port 5433) and Redis 7.4 (port 6380 with 48MB limit). Production deployment under a strict 1 vCPU / 1 GB cgroup will exhibit proportional CPU throttling during heavy concurrent spikes, reinforcing the necessity of Fastify connection throttling and bounded pool sizing.

---

## 2. Memory & Process Footprint Audit

Memory profiling was conducted using `measure-memory.js` against the compiled production distribution (`dist/src/app.module.js`):

```json
NESTJS_LOADED_MEMORY_JSON = {
  "rssMB": 174.19,
  "heapTotalMB": 99.44,
  "heapUsedMB": 54.1,
  "externalMB": 6.03
}
```

### Stack Memory Allocation Breakdown (1 GB RAM Target Profile):

| Process / Component | Allocated / Measured Memory | Peak Observed Memory | Policy / Configuration |
| :--- | :---: | :---: | :--- |
| **NestJS Fastify Backend** | ~175 MB | 215 MB | Node.js `--max-old-space-size=384` |
| **Next.js Production Web** | ~140 MB | 190 MB | Turbopack runtime, static page caching |
| **PostgreSQL 16 Engine** | ~95 MB | 150 MB | `shared_buffers = 128MB`, `work_mem = 4MB` |
| **Redis 7.4 Cache Engine** | 1.32 MB | 48 MB (Capped) | `--maxmemory 48mb --maxmemory-policy volatile-lru` |
| **OS & Buffer Headroom** | ~350 MB | ~400 MB | Linux kernel, page cache, socket buffers |
| **Total Stack Projected** | **~761 MB** | **~1003 MB** | **Fits strictly within 1 GB RAM ceiling** |

---

## 3. Query Plan Audit & `EXPLAIN (ANALYZE, BUFFERS)`

### 3.1 Outbox Polling & Atomic Claim (`benchmark-outbox.js`)
- **Dataset:** 50,000 completed rows, 500 failed rows, 10 processing rows, 20 pending rows.
- **Index Optimization:**
  - Full Index Size: 1,568 kB
  - Option B Partial Index (`WHERE status = 'pending' AND attempts < 3`): **16 kB**
- **Query Plan:**
  ```sql
  UPDATE outbox_events
  SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
  WHERE id IN (
    SELECT id FROM outbox_events
    WHERE status = 'pending' AND attempts < 3
    ORDER BY created_at ASC LIMIT 10
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
  ```
- **Execution Profile:**
  - Planning Time: **0.471 ms**
  - Execution Time: **0.419 ms**
  - Buffers: Shared Hit = 92, Shared Read = 0 (100% in-memory cache hit)
  - Lock Overhead: Zero blocking locks due to `FOR UPDATE SKIP LOCKED`.

### 3.2 Product Catalog & Detail Latencies (`benchmark-products.js`)
- **Product Detail Cache Miss (DB query + Redis SET):** **5.296 ms** (Payload size: 385 bytes)
- **Product Detail Cache Hit (Redis GET + JSON.parse):**
  - Average: **0.242 ms**
  - P50: **0.121 ms**
  - P95: **0.768 ms**
  - P99: **2.843 ms**
- **Catalog Filtered Search (`ILIKE '%polo%'`):**
  - Average: **0.589 ms**
  - P95: **0.841 ms**
- **Catalog Pagination Listing:**
  - Average: **1.528 ms**
  - P95: **2.120 ms**
- **Redis Cache Invalidation (`DEL`):**
  - Average: **0.122 ms**

### 3.3 Checkout Transaction Concurrency (`benchmark-checkout.js`)
- **Scenario:** 20 parallel order checkout requests with inventory deductions and order creation.
- **Results:**
  - Successful: **20 / 20 (100%)**
  - Deadlocks (`40P01`): **0**
  - Average Total Latency: **17.04 ms**
  - P50 Latency: **15.35 ms**
  - P95 Latency: **47.52 ms**
  - DB Transaction Duration: Average **14.90 ms** (P95: **34.40 ms**)
  - Heap Delta: **2.31 MB**
  - Connection Pool: Max = 10, Connections Created = 4, Idle = 4

### 3.4 Refunds & Reverse Logistics Workload (`benchmark-refunds.js`)
- **Refund Creation Latency (n=50):** P50 = **1.92 ms**, P95 = **4.91 ms**, P99 = **6.37 ms**
- **Refund Record Lookup (n=50):** P50 = **0.87 ms**, P95 = **1.39 ms**, P99 = **3.02 ms**
- **Canonical Row-Locked Transaction (n=50):** P50 = **2.50 ms**, P95 = **3.92 ms**, P99 = **4.12 ms**
- **Execution Plan:** Index Scan on `uq_refunds_order_id` (Execution time: **0.030 ms**, Buffers hit: 100%).

### 3.5 Promos & Loyalty Invariants (`benchmark-promos-loyalty.js`)
- **Promo Code Lookup Latency:** P50 = **0.30 ms**, P95 = **1.52 ms**, P99 = **3.28 ms**
- **Loyalty Balance Latency:** P50 = **0.46 ms**, P95 = **0.83 ms**, P99 = **2.45 ms**
- **Execution Time:** **0.064 ms** (Shared Hit: 1)

### 3.6 Reviews & Wishlists Queries (`benchmark-reviews-wishlists.js`)
- **Product Review Listing:** Execution time **0.084 ms** (Quicksort in memory: 25 kB)
- **Review Rating Aggregation (AVG & COUNT):** Execution time **0.071 ms** (Option B partial index)
- **Wishlist Product Lookup:** Execution time **0.031 ms** (Shared Hit: 1)

---

## 4. Production Sizing & SRE Configuration Recommendations

### 4.1 Database Connection Pool
- **PostgreSQL Server:** Set `max_connections = 50`.
- **NestJS Drizzle Pool:**
  ```ts
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ```
  Rationale: On 1 vCPU, connection pool sizes above 10 induce CPU context-switching overhead without increasing throughput.

### 4.2 Outbox Processor Polling Cadence
- **Polling Frequency:** 30 seconds (`@Cron(CronExpression.EVERY_30_SECONDS)`).
- **Batch Limit:** 10 events per poll.
- **Overhead:** Query execution of 0.419 ms every 30 seconds consumes less than 0.002% CPU during idle intervals.

### 4.3 Redis Memory & Eviction Policy
- **Directive:** `--maxmemory 48mb --maxmemory-policy volatile-lru --save "" --appendonly no`
- **Rationale:** Ensures Redis never triggers OS OOM kills. With keys carrying explicit TTLs, `volatile-lru` evicts oldest expired or cached catalog data without dropping unexpired auth sessions or generation keys.
