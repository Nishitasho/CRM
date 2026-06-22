-- AlterTable
ALTER TABLE "price_book_entries" ADD COLUMN     "initial_fee" DECIMAL(18,2),
ADD COLUMN     "recurring_fee" DECIMAL(18,2);
