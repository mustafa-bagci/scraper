-- AlterTable
ALTER TABLE "SearchRun" ADD COLUMN     "cursor" TEXT,
ADD COLUMN     "lockedAt" TIMESTAMP(3);
