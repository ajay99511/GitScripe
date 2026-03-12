/*
  Warnings:

  - You are about to drop the column `embedding` on the `summaries` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "commits_files_changed_idx";

-- DropIndex
DROP INDEX "summaries_embedding_idx";

-- DropIndex
DROP INDEX "summaries_tags_idx";

-- AlterTable
ALTER TABLE "summaries" DROP COLUMN "embedding";
