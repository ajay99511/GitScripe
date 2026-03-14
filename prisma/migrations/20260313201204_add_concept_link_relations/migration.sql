-- AddForeignKey: ConceptLink -> Commit (cascade delete)
ALTER TABLE "concept_links" ADD CONSTRAINT "concept_links_commitSha_fkey"
  FOREIGN KEY ("commitSha") REFERENCES "commits"("sha") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ConceptLink -> Repository (cascade delete)
ALTER TABLE "concept_links" ADD CONSTRAINT "concept_links_repoId_fkey"
  FOREIGN KEY ("repoId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
