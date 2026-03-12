-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateEnum
CREATE TYPE "RepoStatus" AS ENUM ('idle', 'syncing', 'error');

-- CreateEnum
CREATE TYPE "SummaryStatus" AS ENUM ('pending', 'processing', 'done', 'failed');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high');

-- CreateTable
CREATE TABLE "repositories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "githubUrl" TEXT NOT NULL,
    "owner" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "branch" VARCHAR(255) NOT NULL,
    "lastSyncedSha" VARCHAR(40),
    "status" "RepoStatus" NOT NULL DEFAULT 'idle',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commits" (
    "sha" VARCHAR(40) NOT NULL,
    "repoId" UUID NOT NULL,
    "authorName" VARCHAR(255) NOT NULL,
    "authorEmail" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "committedAt" TIMESTAMP(3) NOT NULL,
    "filesChanged" JSONB NOT NULL DEFAULT '[]',
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "diffObjectKey" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commits_pkey" PRIMARY KEY ("sha")
);

-- CreateTable
CREATE TABLE "summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "commitSha" VARCHAR(40) NOT NULL,
    "repoId" UUID NOT NULL,
    "shortSummary" TEXT NOT NULL,
    "detailedSummary" TEXT NOT NULL,
    "inferredIntent" TEXT NOT NULL,
    "fileSummaries" JSONB NOT NULL DEFAULT '{}',
    "moduleSummaries" JSONB NOT NULL DEFAULT '{}',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'low',
    "qualityScore" DOUBLE PRECISION,
    "llmModel" VARCHAR(100),
    "processingMs" INTEGER,
    "status" "SummaryStatus" NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concept_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "concept" VARCHAR(255) NOT NULL,
    "commitSha" VARCHAR(40) NOT NULL,
    "repoId" UUID NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concept_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repositories_githubUrl_key" ON "repositories"("githubUrl");

-- CreateIndex
CREATE INDEX "repositories_owner_name_idx" ON "repositories"("owner", "name");

-- CreateIndex
CREATE INDEX "commits_repoId_idx" ON "commits"("repoId");

-- CreateIndex
CREATE INDEX "commits_committedAt_idx" ON "commits"("committedAt");

-- CreateIndex
CREATE INDEX "commits_repoId_committedAt_idx" ON "commits"("repoId", "committedAt");

-- CreateIndex
CREATE UNIQUE INDEX "summaries_commitSha_key" ON "summaries"("commitSha");

-- CreateIndex
CREATE INDEX "summaries_repoId_idx" ON "summaries"("repoId");

-- CreateIndex
CREATE INDEX "summaries_commitSha_idx" ON "summaries"("commitSha");

-- CreateIndex
CREATE INDEX "summaries_repoId_status_idx" ON "summaries"("repoId", "status");

-- CreateIndex
CREATE INDEX "concept_links_concept_idx" ON "concept_links"("concept");

-- CreateIndex
CREATE INDEX "concept_links_repoId_idx" ON "concept_links"("repoId");

-- CreateIndex
CREATE INDEX "concept_links_commitSha_idx" ON "concept_links"("commitSha");

-- AddForeignKey
ALTER TABLE "commits" ADD CONSTRAINT "commits_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_commitSha_fkey" FOREIGN KEY ("commitSha") REFERENCES "commits"("sha") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
