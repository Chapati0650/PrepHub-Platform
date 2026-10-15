-- A district's own mark, shown to its students inside the product so PrepHub
-- reads as something their school provides. Optional; nothing depends on it.
ALTER TABLE "organizations" ADD COLUMN "logoMediaId" TEXT;

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_logoMediaId_fkey"
  FOREIGN KEY ("logoMediaId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
